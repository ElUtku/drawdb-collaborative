import {
  Collapse,
  Input,
  InputNumber,
  Select,
  Switch,
} from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";

// Settings form of an export dialog. `defs` describe each setting (see
// utils/exportSQL/options.js); labels, descriptions and choice names come from
// the translations `<prefix>_<key>`, `<prefix>_<key>_desc` and
// `<prefix>_<key>_<choice>`. Basic settings are always visible, the rest sit
// under "Advanced".
function Row({ label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-xs opacity-60 leading-snug">{description}</div>
        )}
      </div>
      <div className="shrink-0 w-56 flex justify-end">{children}</div>
    </div>
  );
}

export default function ExportOptions({ defs, values, onChange, prefix }) {
  const { t } = useTranslation();
  const text = (key, fallback) => t(key, { defaultValue: fallback ?? "" });
  const set = (key) => (value) => onChange({ ...values, [key]: value });

  const control = (def) => {
    const value = values[def.key] ?? def.default;
    switch (def.type) {
      case "bool":
        return (
          <Switch
            size="small"
            checked={Boolean(value)}
            onChange={set(def.key)}
          />
        );
      case "select":
        return (
          <Select
            className="w-full"
            size="small"
            value={value}
            optionList={def.choices.map((choice) => ({
              value: choice,
              label: text(`${prefix}_${def.key}_${choice}`, choice),
            }))}
            onChange={set(def.key)}
          />
        );
      case "number":
        return (
          <InputNumber
            size="small"
            className="w-full"
            value={value}
            min={def.min}
            max={def.max}
            placeholder={def.placeholder}
            onChange={(number) =>
              Number.isFinite(number) && set(def.key)(number)
            }
          />
        );
      default:
        return (
          <Input
            size="small"
            value={value}
            placeholder={def.placeholder}
            onChange={set(def.key)}
          />
        );
    }
  };

  const row = (def) => (
    <Row
      key={def.key}
      label={text(`${prefix}_${def.key}`, def.key)}
      description={text(`${prefix}_${def.key}_desc`)}
    >
      {control(def)}
    </Row>
  );

  const basic = defs.filter((def) => def.section === "basic");
  const advanced = defs.filter((def) => def.section !== "basic");

  return (
    <div className="mt-2">
      {basic.length > 0 && <div className="px-1">{basic.map(row)}</div>}
      {advanced.length > 0 && (
        <Collapse className="mt-1">
          <Collapse.Panel
            header={t("export_advanced", { defaultValue: "Advanced" })}
            itemKey="advanced"
          >
            {advanced.map(row)}
          </Collapse.Panel>
        </Collapse>
      )}
    </div>
  );
}
