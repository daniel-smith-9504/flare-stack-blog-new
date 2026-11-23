import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readingHistoryQuery } from "@/features/reading-history/queries";
import { formatDate } from "@/lib/utils";
import { m } from "@/paraglide/messages";

function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return m.profile_reading_minutes({ minutes });
  const hours = Math.floor(minutes / 60);
  return m.profile_reading_hours({ hours, minutes: minutes % 60 });
}

/** 阅读记录: the articles and novels this reader has opened, on the profile. */
export function ReadingHistorySection() {
  const { data, isPending, isError, refetch } = useQuery(readingHistoryQuery);
  return (
    <section className="account-setting">
      <div className="account-reading">
        <h2>{m.profile_reading_title()}</h2>
        <p>{m.profile_reading_intro()}</p>
        {isError ? (
          <div>
            <p>{m.profile_reading_failed()}</p>
            <Button variant="text" size="sm" onClick={() => void refetch()}>
              {m.account_retry()}
            </Button>
          </div>
        ) : isPending ? (
          <p>{m.profile_reading_loading()}</p>
        ) : (
          <>
            <dl className="account-reading-summary">
              <div>
                <dt>{m.profile_reading_posts()}</dt>
                <dd>{data.summary.posts}</dd>
              </div>
              <div>
                <dt>{m.profile_reading_novels()}</dt>
                <dd>{data.summary.novels}</dd>
              </div>
              <div>
                <dt>{m.profile_reading_time()}</dt>
                <dd>{duration(data.summary.seconds)}</dd>
              </div>
            </dl>
            <div className="account-reading-columns">
              <div>
                <h3>
                  <FileText size={15} />
                  {m.profile_reading_recent_posts()}
                </h3>
                {data.posts.length === 0 ? (
                  <p className="account-reading-empty">
                    {m.profile_reading_no_posts()}
                  </p>
                ) : (
                  <ul>
                    {data.posts.map((post) => (
                      <li key={post.id}>
                        <Link to="/post/$slug" params={{ slug: post.slug }}>
                          {post.title}
                        </Link>
                        <span>
                          {formatDate(post.lastReadAt, {
                            includeTime: false,
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>
                  <BookOpen size={15} />
                  {m.profile_reading_recent_novels()}
                </h3>
                {data.novels.length === 0 ? (
                  <p className="account-reading-empty">
                    {m.profile_reading_no_novels()}
                  </p>
                ) : (
                  <ul>
                    {data.novels.map((novel) => (
                      <li key={novel.id}>
                        <Link
                          to="/novels/$id/read"
                          params={{ id: String(novel.id) }}
                          search={{ chapter: novel.chapterOrder }}
                        >
                          {novel.title}
                        </Link>
                        <span>
                          {m.profile_reading_chapter({
                            chapter: novel.chapterOrder,
                            total: novel.chapterCount,
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
