import { Collapse, Input, Select, Switch } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs opacity-60">{hint}</div>}
      </div>
      <div className="shrink-0 w-56 flex justify-end">{children}</div>
    </div>
  );
}

export default function ProtobufOptions({ options, defaultPackage, onChange }) {
  const { t } = useTranslation();
  const set = (key) => (value) => onChange({ ...options, [key]: value });

  const select = (key, values) => (
    <Select
      className="w-full"
      size="small"
      value={options[key]}
      optionList={values.map(([value, label]) => ({ value, label }))}
      onChange={set(key)}
    />
  );
  const toggle = (key) => (
    <Switch size="small" checked={options[key]} onChange={set(key)} />
  );
  const text = (key, placeholder) => (
    <Input
      size="small"
      value={options[key]}
      placeholder={placeholder}
      onChange={set(key)}
    />
  );

  return (
    <Collapse className="mt-2">
      <Collapse.Panel header={t("proto_advanced")} itemKey="advanced">
        <div className="text-xs font-semibold uppercase opacity-60 mt-1">
          {t("proto_section_file")}
        </div>
        <Row label={t("proto_package")}>
          {text("packageName", defaultPackage)}
        </Row>
        <Row label="go_package">{text("goPackage", "")}</Row>
        <Row label="java_package">{text("javaPackage", "")}</Row>

        <div className="text-xs font-semibold uppercase opacity-60 mt-3">
          {t("proto_section_naming")}
        </div>
        <Row label={t("proto_message_case")}>
          {select("messageCase", [
            ["pascal", "PascalCase"],
            ["original", t("proto_keep_original")],
          ])}
        </Row>
        <Row label={t("proto_singularize")} hint={t("proto_singularize_hint")}>
          {toggle("singularizeMessages")}
        </Row>
        <Row label={t("proto_message_suffix")}>
          {text("messageSuffix", "Dto, Entity…")}
        </Row>
        <Row label={t("proto_field_case")}>
          {select("fieldCase", [
            ["snake", "snake_case"],
            ["camel", "camelCase"],
            ["original", t("proto_keep_original")],
          ])}
        </Row>
        <Row label={t("proto_enum_values")} hint={t("proto_enum_values_hint")}>
          {select("enumValueStyle", [
            ["prefixed", "STATUS_PAID"],
            ["plain", "PAID"],
          ])}
        </Row>

        <div className="text-xs font-semibold uppercase opacity-60 mt-3">
          {t("proto_section_types")}
        </div>
        <Row label={t("proto_nullable_optional")}>
          {toggle("nullableAsOptional")}
        </Row>
        <Row label="DECIMAL / NUMERIC">
          {select("decimalAs", [
            ["string", "string"],
            ["double", "double"],
          ])}
        </Row>
        <Row label="TIMESTAMP / DATETIME">
          {select("timestampAs", [
            ["timestamp", "google.protobuf.Timestamp"],
            ["int64", "int64 (epoch)"],
            ["string", "string (ISO 8601)"],
          ])}
        </Row>
        <Row label="DATE">
          {select("dateAs", [
            ["string", "string"],
            ["google_date", "google.type.Date"],
          ])}
        </Row>
        <Row label="JSON / JSONB">
          {select("jsonAs", [
            ["value", "google.protobuf.Value"],
            ["struct", "google.protobuf.Struct"],
            ["string", "string"],
          ])}
        </Row>
        <Row label="UUID">
          {select("uuidAs", [
            ["string", "string"],
            ["bytes", "bytes"],
          ])}
        </Row>

        <div className="text-xs font-semibold uppercase opacity-60 mt-3">
          {t("proto_section_output")}
        </div>
        <Row label={t("proto_comments")}>{toggle("includeComments")}</Row>
        <Row label={t("proto_constraint_comments")}>
          {toggle("includeConstraintComments")}
        </Row>
        <Row label={t("proto_service")}>
          {select("service", [
            ["none", t("proto_service_none")],
            ["crud", t("proto_service_crud")],
          ])}
        </Row>
      </Collapse.Panel>
    </Collapse>
  );
}
