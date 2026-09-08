/**
 * 作品详情的 Statistics。
 *
 * 作用：对齐图站侧栏：Id / Posted / Size / Source / Rating。
 * 用法：详情标题下 <WorkStats work={work} onAuthor={searchAuthor} />。
 * 为什么：卡片标题塞不下发布时间、来源链接和分级。
 */
import { Link } from "@tanstack/react-router";
import type { Source, WorkDetail } from "@/lib/types";
import { isBooru } from "@/lib/sites";
import { formatPostedAt, formatRatingLabel, formatResolution, httpSourceHref } from "@/lib/utils";

export function WorkStats({
  work,
  onAuthor,
}: {
  work: WorkDetail;
  onAuthor?: (name: string) => void;
}) {
  const size = formatResolution(work.width, work.height);
  const posted = formatPostedAt(work.date);
  const rating = formatRatingLabel(work.rating, work.source);
  const sourceHref = httpSourceHref(work.originSource);
  const sourceText = work.originSource?.replace(/^https?:\/\//i, "") ?? "";
  if (!work.id && !posted && !size && !sourceText && !rating) return null;

  return (
    <dl className="grid max-w-xl grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 pb-3 text-sm">
      <dt className="text-subtle">Id</dt>
      <dd className="tabular-nums text-fg">{work.id}</dd>
      {posted || work.author ? (
        <>
          <dt className="text-subtle">Posted</dt>
          <dd className="min-w-0 text-fg">
            {posted || "—"}
            {work.author ? (
              <>
                {" "}
                by{" "}
                <AuthorLink source={work.source} author={work.author} authorId={work.authorId} onAuthor={onAuthor} />
              </>
            ) : null}
          </dd>
        </>
      ) : null}
      {size ? (
        <>
          <dt className="text-subtle">Size</dt>
          <dd className="tabular-nums text-fg">{size}</dd>
        </>
      ) : null}
      {sourceText ? (
        <>
          <dt className="text-subtle">Source</dt>
          <dd className="min-w-0 truncate text-fg">
            {sourceHref ? (
              <a href={sourceHref} target="_blank" rel="noreferrer" className="hover:underline">
                {sourceText}
              </a>
            ) : (
              sourceText
            )}
          </dd>
        </>
      ) : null}
      {rating ? (
        <>
          <dt className="text-subtle">Rating</dt>
          <dd className="text-fg">{rating}</dd>
        </>
      ) : null}
    </dl>
  );
}

function AuthorLink({
  source,
  author,
  authorId,
  onAuthor,
}: {
  source: Source;
  author: string;
  authorId: string;
  onAuthor?: (name: string) => void;
}) {
  if (source === "pixiv" && authorId) {
    return (
      <Link to="/user/$id" params={{ id: authorId }} className="hover:underline">
        {author}
      </Link>
    );
  }
  if (source === "fanbox" && authorId) {
    return (
      <Link to="/creator/$id" params={{ id: authorId }} className="hover:underline">
        {author}
      </Link>
    );
  }
  if (isBooru(source) && onAuthor) {
    return (
      <button type="button" className="hover:underline" onClick={() => onAuthor(author)}>
        {author}
      </button>
    );
  }
  return <span>{author}</span>;
}
