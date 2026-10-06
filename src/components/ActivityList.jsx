import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";

// One line per audit entry: when, who, what. Actions are translated through
// `audit_<action>` (dots become underscores); unknown ones show as they are.
const DETAIL_KEYS = [
  "role",
  "linkAccess",
  "from",
  "version",
  "diagramsTransferred",
  "transferredTo",
];

function details(entry) {
  if (!entry.details) return "";
  const parts = [];
  for (const key of DETAIL_KEYS) {
    if (entry.details[key] !== undefined && entry.details[key] !== null) {
      parts.push(`${key}: ${entry.details[key]}`);
    }
  }
  if (Array.isArray(entry.details.added) && entry.details.added.length) {
    parts.push(`+ ${entry.details.added.join(", ")}`);
  }
  if (Array.isArray(entry.details.removed) && entry.details.removed.length) {
    parts.push(`− ${entry.details.removed.join(", ")}`);
  }
  return parts.join(" · ");
}

export default function ActivityList({ entries, showDiagram = false }) {
  const { t, i18n } = useTranslation();
  if (!entries.length) {
    return (
      <div className="text-sm text-zinc-500 py-6 text-center">
        {t("activity_empty")}
      </div>
    );
  }
  return (
    <ul className="text-sm divide-y divide-zinc-200 dark:divide-zinc-700">
      {entries.map((entry) => {
        const when = DateTime.fromISO(entry.at).setLocale(i18n.language);
        const extra = details(entry);
        return (
          <li key={entry.id} className="py-2 flex gap-3">
            <span
              className="text-xs text-zinc-500 w-28 shrink-0"
              title={when.toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)}
            >
              {when.toRelative()}
            </span>
            <span className="min-w-0">
              <span className="font-medium">
                {entry.username ?? t("activity_system")}
              </span>{" "}
              {t(`audit_${entry.action.replace(/\./g, "_")}`, {
                defaultValue: entry.action,
              })}
              {entry.target && (
                <span className="text-zinc-600 dark:text-zinc-300">
                  {" "}
                  {entry.target}
                </span>
              )}
              {showDiagram && entry.diagramId && (
                <span className="text-xs text-zinc-500">
                  {" "}
                  ({entry.diagramId.slice(0, 8)})
                </span>
              )}
              {extra && (
                <span className="block text-xs text-zinc-500">{extra}</span>
              )}
              {entry.ip && (
                <span className="block text-xs text-zinc-400">{entry.ip}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
