import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

/** GEN-08: at most 5 MB per image. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Images are served from this URL path. */
export const UPLOADS_URL_PREFIX = '/uploads';

/** Where uploaded files live: UPLOADS_DIR, or backend/uploads. */
export function uploadsDirectory(): string {
  return resolve(process.env.UPLOADS_DIR?.trim() || 'uploads');
}

/** The fields of an uploaded file that this service reads. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/** Recognises JPG and PNG by their first bytes, not by name or header. */
export function imageExtension(buffer: Buffer): 'jpg' | 'png' | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  )
    return 'jpg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && png.every((byte, i) => buffer[i] === byte))
    return 'png';
  return null;
}

/**
 * GEN-08: JPG or PNG images up to 5 MB, stored on the server and served by
 * URL. Callers enforce the count (5 per post, activity or hotel).
 */
@Injectable()
export class ImageUploadsService {
  private readonly logger = new Logger(ImageUploadsService.name);

  /** Saves the image under uploads/<folder>/ and returns its URL. */
  async save(file: UploadedImage | undefined, folder: string): Promise<string> {
    if (!file?.buffer?.length)
      throw new BadRequestException(
        'Attach a JPG or PNG file in the "image" form field.',
      );
    if (file.size > MAX_IMAGE_BYTES)
      throw new BadRequestException('Images must be 5 MB or smaller.');
    const extension = imageExtension(file.buffer);
    if (!extension)
      throw new BadRequestException('Only JPG and PNG images are accepted.');

    const directory = join(uploadsDirectory(), folder);
    await mkdir(directory, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    await writeFile(join(directory, name), file.buffer);
    return `${UPLOADS_URL_PREFIX}/${folder}/${name}`;
  }

  /**
   * Copies a saved image so a clone owns its own file (ITN-21). Returns the
   * original URL if the file cannot be copied.
   */
  async duplicate(url: string, folder: string): Promise<string> {
    const source = this.pathOf(url);
    const extension = url.split('.').pop();
    if (!source || (extension !== 'jpg' && extension !== 'png')) return url;
    const directory = join(uploadsDirectory(), folder);
    await mkdir(directory, { recursive: true });
    const name = `${randomUUID()}.${extension}`;
    try {
      await copyFile(source, join(directory, name));
      return `${UPLOADS_URL_PREFIX}/${folder}/${name}`;
    } catch {
      this.logger.warn(`Could not copy ${url}.`);
      return url;
    }
  }

  /** The file path for an uploads URL, never outside the uploads directory. */
  private pathOf(url: string): string | null {
    if (!url.startsWith(`${UPLOADS_URL_PREFIX}/`)) return null;
    const path = resolve(
      uploadsDirectory(),
      url.slice(UPLOADS_URL_PREFIX.length + 1),
    );
    return path.startsWith(uploadsDirectory()) ? path : null;
  }

  /** Deletes a file saved by save(); a missing file is not an error. */
  async remove(url: string): Promise<void> {
    if (!url.startsWith(`${UPLOADS_URL_PREFIX}/`)) return;
    const path = resolve(
      uploadsDirectory(),
      url.slice(UPLOADS_URL_PREFIX.length + 1),
    );
    // Never delete outside the uploads directory.
    if (!path.startsWith(uploadsDirectory())) return;
    try {
      await unlink(path);
    } catch {
      this.logger.warn(`Could not delete ${url}.`);
    }
  }
}
