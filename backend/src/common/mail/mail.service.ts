import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends account emails (ACC-02, ACC-07) through SMTP (GEN-01-B). Set
 * SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in backend/.env;
 * a test inbox such as Ethereal or Mailtrap works for development. Without
 * SMTP_HOST, emails are written to the server console instead, so links
 * can still be followed locally. Links are never returned by the API.
 */
@Injectable()
export class MailService {
  private transporter?: Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    if (!host) {
      this.logger.log(
        `SMTP is not configured; email not sent.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
      );
      return;
    }
    try {
      await this.transport(host).sendMail({
        from:
          this.config.get<string>('MAIL_FROM')?.trim() ||
          'Travel Planning <no-reply@travelplanning.local>',
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch (error) {
      // An email problem must not break the request that triggered it.
      this.logger.error(
        `Could not send "${message.subject}" (${error instanceof Error ? error.message : 'unknown error'}).`,
      );
    }
  }

  /** The public base URL of this API, for links in emails. */
  apiUrl(): string {
    return (
      this.config.get<string>('API_PUBLIC_URL')?.trim() ||
      `http://localhost:${this.config.get<string>('PORT') ?? 3000}`
    ).replace(/\/+$/, '');
  }

  /** The frontend's base URL, for links that open a page (Milestone 2). */
  frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL')?.trim() || 'http://localhost:3001'
    ).replace(/\/+$/, '');
  }

  private transport(host: string): Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const user = this.config.get<string>('SMTP_USER')?.trim();
      this.transporter = createTransport({
        host,
        port,
        secure: port === 465,
        auth: user
          ? { user, pass: this.config.get<string>('SMTP_PASS') ?? '' }
          : undefined,
      });
    }
    return this.transporter;
  }
}
