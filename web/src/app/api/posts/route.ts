import { errorResponse, requireUser } from "@/lib/guard";
import { myPosts } from "@/lib/public-posts";
import { publicOrigin } from "@/lib/origins";

/** The user's public posts and their applications. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const origin = publicOrigin(req);
    const posts = await myPosts(user.id);
    return new Response(JSON.stringify({ posts: posts.map((p) => ({ ...p, link: `${origin}/apply/${p.slug}` })) }), { headers: { "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err);
  }
}
