import { Collapse } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";

const LEVELS = [
  { level: "error", icon: "bi-x-circle-fill", color: "text-red-500" },
  {
    level: "warning",
    icon: "bi-exclamation-triangle-fill",
    color: "text-amber-500",
  },
  { level: "info", icon: "bi-info-circle-fill", color: "text-sky-500" },
];

// What an exporter had to adapt, left out, or expects to be rejected. Each
// issue is translated through `<prefix>_<code>`, falling back to `format`.
// Errors are open by default because the output will likely fail.
export default function ExportIssues({ issues, prefix, format }) {
  const { t } = useTranslation();
  if (!issues?.length) return null;

  const message = (issue) =>
    t(`${prefix}_${issue.code}`, {
      ...issue.params,
      defaultValue: format(issue),
      interpolation: { escapeValue: false },
    });
  const counts = LEVELS.map(({ level }) => ({
    level,
    count: issues.filter((i) => i.level === level).length,
  }));
  const hasErrors = counts[0].count > 0;

  return (
    <Collapse className="mt-2" defaultActiveKey={hasErrors ? ["issues"] : []}>
      <Collapse.Panel
        itemKey="issues"
        header={
          <div className="flex gap-3 items-center text-sm">
            <span>{t("export_review", { defaultValue: "Review" })}</span>
            {LEVELS.map(({ level, icon, color }, i) =>
              counts[i].count ? (
                <span key={level} className={color}>
                  <i className={`bi ${icon} me-1`} />
                  {counts[i].count}
                </span>
              ) : null,
            )}
          </div>
        }
      >
        <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
          {LEVELS.flatMap(({ level, icon, color }) =>
            issues
              .filter((issue) => issue.level === level)
              .map((issue, i) => (
                <li key={`${level}-${i}`} className="flex gap-2">
                  <i className={`bi ${icon} ${color} mt-0.5`} />
                  <span>{message(issue)}</span>
                </li>
              )),
          )}
        </ul>
      </Collapse.Panel>
    </Collapse>
  );
}
