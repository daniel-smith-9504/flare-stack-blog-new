import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TrendChart } from "@/features/dashboard/components/trend-chart";
import { formatCount } from "@/features/dashboard/components/format";
import type {
  AnalyticsDevice,
  AnalyticsReport,
} from "@/features/analytics/analytics.schema";
import {
  analyticsQuery,
  type AnalyticsDays,
} from "@/features/analytics/queries";
import { m } from "@/paraglide/messages";
import "./analytics.css";

const RANGES: ReadonlyArray<AnalyticsDays> = [7, 30, 90];

/**
 * 「统计」: what this Worker recorded itself. No third-party service is asked;
 * every reading comes from the `page_views` table of the site's own D1.
 */
export function AnalyticsPage() {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const { data, isFetching } = useQuery(analyticsQuery(days));

  return (
    <div className="analytics-scroll">
      <div className="analytics" data-fetching={isFetching ? "" : undefined}>
        <header className="analytics-head">
          <div>
            <h1 className="analytics-title">{m.admin_analytics_title()}</h1>
            <p className="analytics-description">
              {m.admin_analytics_description({ days })}
            </p>
          </div>
          <div className="analytics-ranges" role="group">
            {RANGES.map((range) => (
              <Button
                key={range}
                size="xs"
                variant={range === days ? "ink" : "quiet"}
                onClick={() => setDays(range)}
              >
                {m.admin_analytics_range({ days: range })}
              </Button>
            ))}
          </div>
        </header>

        {data ? (
          <Report report={data} />
        ) : (
          <p className="analytics-empty">{m.admin_analytics_loading()}</p>
        )}
      </div>
    </div>
  );
}

function Report({ report }: { report: AnalyticsReport }) {
  return (
    <>
      <div className="analytics-totals">
        <Total label={m.admin_analytics_views()} value={report.summary.views} />
        <Total
          label={m.admin_analytics_visitors()}
          value={report.summary.visitors}
        />
      </div>

      <section className="analytics-card analytics-trend">
        <h2 className="analytics-card-title">{m.admin_analytics_daily()}</h2>
        {report.daily.length >= 2 ? (
          <TrendChart
            series={report.daily}
            label={m.admin_analytics_daily_label()}
          />
        ) : (
          <p className="analytics-empty">{m.admin_analytics_empty()}</p>
        )}
      </section>

      <div className="analytics-grid">
        <Breakdown
          title={m.admin_analytics_top_pages()}
          rows={report.topPages.map((page) => ({
            label: page.path,
            value: page.views,
          }))}
        />
        <Breakdown
          title={m.admin_analytics_top_posts()}
          rows={report.topPosts.map((post) => ({
            label: post.title,
            value: post.views,
          }))}
        />
        <Breakdown
          title={m.admin_analytics_referrers()}
          rows={report.referrers.map((referrer) => ({
            label: referrer.host,
            value: referrer.views,
          }))}
        />
        <Breakdown title={m.admin_analytics_places()} rows={places(report)} />
        <Breakdown
          title={m.admin_analytics_devices()}
          rows={report.devices.map((device) => ({
            label: deviceLabel(device.device),
            value: device.views,
          }))}
        />
      </div>
    </>
  );
}

function deviceLabel(device: AnalyticsDevice): string {
  switch (device) {
    case "mobile":
      return m.admin_analytics_device_mobile();
    case "tablet":
      return m.admin_analytics_device_tablet();
    default:
      return m.admin_analytics_device_desktop();
  }
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="analytics-card analytics-total">
      <p className="analytics-kicker">{label}</p>
      <p className="analytics-big">{formatCount(value)}</p>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
}) {
  return (
    <section className="analytics-card">
      <h2 className="analytics-card-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="analytics-empty">{m.admin_analytics_empty()}</p>
      ) : (
        <ol className="analytics-list">
          {rows.map((row) => (
            <li key={row.label} className="analytics-row">
              <span className="analytics-row-label" title={row.label}>
                {row.label}
              </span>
              <span className="analytics-row-value">
                {formatCount(row.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Cities when Cloudflare knows them, the regions otherwise. */
function places(report: AnalyticsReport) {
  if (report.cities.length > 0) {
    return report.cities.map((place) => ({
      label: [place.region, place.city].filter(Boolean).join(" · "),
      value: place.views,
    }));
  }
  return report.regions.map((place) => ({
    label: [countryName(place.country), place.region]
      .filter(Boolean)
      .join(" · "),
    value: place.views,
  }));
}

function countryName(country: string): string {
  try {
    return (
      new Intl.DisplayNames([document.documentElement.lang], {
        type: "region",
      }).of(country) ?? country
    );
  } catch {
    return country;
  }
}
