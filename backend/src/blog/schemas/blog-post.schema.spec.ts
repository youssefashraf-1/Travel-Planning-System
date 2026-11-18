import { model, Types } from 'mongoose';
import { BlogPost, BlogPostSchema, BlogPostStatus } from './blog-post.schema';

const Post = model(BlogPost.name, BlogPostSchema);
const post = {
  authorId: new Types.ObjectId(),
  title: 'Cairo',
  body: 'A trip report',
};

describe('Blog publishing', () => {
  it('requires the publication timestamp only for a published post', async () => {
    const draft = new Post(post);
    await expect(draft.validate()).resolves.toBeUndefined();

    draft.status = BlogPostStatus.PUBLISHED;
    await expect(draft.validate()).rejects.toMatchObject({
      errors: { publishedAt: expect.any(Error) },
    });
  });

  it('rejects duplicate tags after normalization and more than five images', async () => {
    const draft = new Post({
      ...post,
      tags: ['Egypt', ' egypt '],
      images: Array.from({ length: 6 }, (_, id) => ({
        url: `/images/${id}.jpg`,
      })),
    });

    await expect(draft.validate()).rejects.toMatchObject({
      errors: { tags: expect.any(Error), images: expect.any(Error) },
    });
  });
});
