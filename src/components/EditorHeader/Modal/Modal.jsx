import {
  Button,
  Image,
  Input,
  Modal as SemiUIModal,
  Select,
  Spin,
  Toast,
} from "@douyinfe/semi-ui";
import { saveAs } from "file-saver";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Action, DB, MODAL, ObjectType, STATUS } from "../../../data/constants";
import { databases } from "../../../data/databases";
import {
  useAreas,
  useDiagram,
  useEnums,
  useLayout,
  useNavigateWithParams,
  useNotes,
  useSettings,
  useTransform,
  useTypes,
  useUndoRedo,
} from "../../../hooks";
import { isRtl } from "../../../i18n/utils/rtl";
import { importSQL } from "../../../utils/importSQL";
import { normalizeSQLForParser } from "../../../utils/importSQL/normalize";
import {
  getModalTitle,
  getModalWidth,
  getOkText,
} from "../../../utils/modalData";
import CodeEditor from "../../CodeEditor";
import ImportDiagram from "./ImportDiagram";
import ImportSource from "./ImportSource";
import Language from "./Language";
import New from "./New";
import Open from "./Open";
import Rename from "./Rename";
import SetTableWidth from "./SetTableWidth";
import ExportOptions from "./ExportOptions";
import ExportIssues from "./ExportIssues";
import {
  assignProtoNumbers,
  defaultProtobufOptions,
  formatProtoIssue,
  generateProtobuf,
  PROTO_OPTION_DEFS,
} from "../../../utils/exportAs/protobuf";
import {
  CPP_OPTION_DEFS,
  defaultCppOptions,
  formatCppIssue,
  generateCpp,
} from "../../../utils/exportAs/cpp";
import {
  defaultMigrationOptions,
  defaultSqlOptions,
  formatIssue,
  generateMigration,
  generateSQL,
  migrationOptionDefsFor,
  sqlOptionDefsFor,
} from "../../../utils/exportSQL";
import {
  loadExportOptions,
  saveExportOptions,
} from "../../../utils/exportPreferences";
import { mergeCustomTypes } from "../../../utils/customTypes";

const extensionToLanguage = {
  md: "markdown",
  sql: "sql",
  dbml: "dbml",
  json: "json",
  proto: "proto",
  hpp: "cpp",
};

const extensionToMimeType = {
  md: "text/markdown",
  sql: "application/sql",
  json: "application/json",
};

export default function Modal({
  modal,
  setModal,
  title,
  setTitle,
  exportData,
  setExportData,
  importDb,
  importFrom,
  saveAsCopy,
}) {
  const { t, i18n } = useTranslation();
  const { tables, setTables, updateTable, setRelationships, database } =
    useDiagram();
  const { setNotes } = useNotes();
  const { setAreas } = useAreas();
  const { setTypes } = useTypes();
  const { setEnums } = useEnums();
  const { setTransform } = useTransform();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { settings, setSettings } = useSettings();
  const { layout } = useLayout();
  const [uncontrolledTitle, setUncontrolledTitle] = useState(title);
  const [uncontrolledLanguage, setUncontrolledLanguage] = useState(
    i18n.language,
  );
  const [tempTableWidth, setTempTableWidth] = useState(settings.tableWidth);
  const [importSource, setImportSource] = useState({
    src: "",
    overwrite: false,
  });
  const [importData, setImportData] = useState(null);
  const [error, setError] = useState({
    type: STATUS.NONE,
    message: "",
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState(-1);
  const [selectedDiagramId, setSelectedDiagramId] = useState(0);
  const [saveAsTitle, setSaveAsTitle] = useState(title);
  const navigate = useNavigateWithParams();

  useEffect(() => {
    if (modal === MODAL.SAVEAS) setSaveAsTitle(title);
  }, [modal, title]);

  const overwriteDiagram = () => {
    setTables(importData.tables);
    setRelationships(importData.relationships);
    setAreas(importData.subjectAreas ?? []);
    setNotes(importData.notes ?? []);
    if (importData.title) {
      setTitle(importData.title);
    }
    if (databases[database].hasEnums && importData.enums) {
      setEnums(importData.enums);
    }
    if (databases[database].hasTypes && importData.types) {
      setTypes(importData.types);
    }
    if (importData.customTypes) {
      mergeCustomTypes(importData.customTypes).catch((error) =>
        Toast.error(error.message || t("custom_types_save_failed")),
      );
    }
  };

  // The SQL grammars are large enough to dominate the main bundle, so they are
  // loaded on demand when an import is actually run.
  const parseSQLAndLoadDiagram = async () => {
    const targetDatabase = database === DB.GENERIC ? importDb : database;

    let ast = null;
    try {
      if (targetDatabase === DB.ORACLESQL) {
        const { Parser: OracleParser } = await import("oracle-sql-parser");
        const oracleParser = new OracleParser();

        ast = oracleParser.parse(importSource.src);
      } else {
        const { Parser } = await import("node-sql-parser");
        const parser = new Parser();
        const normalizedSource = normalizeSQLForParser(
          importSource.src,
          targetDatabase,
        );

        ast = parser.astify(normalizedSource, {
          database: targetDatabase,
        });
      }
    } catch (error) {
      const message = error.location
        ? `${error.name} [Ln ${error.location.start.line}, Col ${error.location.start.column}]: ${error.message}`
        : error.message;

      setError({ type: STATUS.ERROR, message });
      return;
    }

    try {
      const diagramData = importSQL(
        ast,
        database === DB.GENERIC ? importDb : database,
        database,
      );

      if (importSource.overwrite) {
        setTables(diagramData.tables);
        setRelationships(diagramData.relationships);
        if (databases[database].hasTypes) setTypes(diagramData.types ?? []);
        if (databases[database].hasEnums) setEnums(diagramData.enums ?? []);
        setTransform((prev) => ({ ...prev, pan: { x: 0, y: 0 } }));
        setNotes([]);
        setAreas([]);
      } else {
        setTables((prev) => [...prev, ...diagramData.tables]);
        setRelationships((prev) =>
          [...prev, ...diagramData.relationships].map((r, i) => ({
            ...r,
            id: i,
          })),
        );
        if (databases[database].hasTypes && diagramData.types.length)
          setTypes((prev) => [...prev, ...diagramData.types]);
        if (databases[database].hasEnums && diagramData.enums.length)
          setEnums((prev) => [...prev, ...diagramData.enums]);
      }

      setUndoStack([]);
      setRedoStack([]);

      setModal(MODAL.NONE);
    } catch (e) {
      setError({
        type: STATUS.ERROR,
        message: `Please check for syntax errors or let us know about the error.`,
      });
    }
  };

  const getModalOnOk = async () => {
    switch (modal) {
      case MODAL.IMG:
        saveAs(
          exportData.data,
          `${exportData.filename}.${exportData.extension}`,
        );
        return;
      case MODAL.CODE: {
        const blob = new Blob([exportData.data], {
          type: `${extensionToMimeType[exportData.extension] ?? "text/plain"};charset=utf-8`,
        });
        saveAs(blob, `${exportData.filename}.${exportData.extension}`);
        return;
      }
      case MODAL.IMPORT:
        if (error.type !== STATUS.ERROR) {
          setTransform((prev) => ({ ...prev, pan: { x: 0, y: 0 } }));
          overwriteDiagram();
          setImportData(null);
          setModal(MODAL.NONE);
          setUndoStack([]);
          setRedoStack([]);
        }
        return;
      case MODAL.IMPORT_SRC:
        parseSQLAndLoadDiagram();
        return;
      case MODAL.OPEN:
        if (!selectedDiagramId) return;
        navigate(`/editor/diagrams/${selectedDiagramId}`, "_blank");
        setModal(MODAL.NONE);
        return;
      case MODAL.RENAME:
        setTitle(uncontrolledTitle);
        setModal(MODAL.NONE);
        return;
      case MODAL.SAVEAS:
        await saveAsCopy(saveAsTitle);
        setModal(MODAL.NONE);
        return;
      case MODAL.NEW:
        window.open("/editor/templates/" + selectedTemplateId, "_blank");
        setModal(MODAL.NONE);
        return;
      case MODAL.LANGUAGE:
        i18n.changeLanguage(uncontrolledLanguage);
        setModal(MODAL.NONE);
        return;
      case MODAL.TABLE_WIDTH:
        setSettings((prev) => ({ ...prev, tableWidth: tempTableWidth }));
        setModal(MODAL.NONE);
        return;
      default:
        setModal(MODAL.NONE);
        return;
    }
  };

  // Stores the field numbers the Protobuf export assigned, so that adding,
  // moving or deleting columns no longer renumbers existing fields.
  const saveProtoNumbers = () => {
    const numbered = assignProtoNumbers(tables);
    if (numbered === tables) return;
    const changed = numbered.filter((table, i) => table !== tables[i]);
    changed.forEach((table) => updateTable(table.id, { fields: table.fields }));
    // An undoable edit like any other, which also triggers the save.
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        bulk: true,
        message: t("proto_save_numbers"),
        elements: changed.map((table) => ({
          id: table.id,
          type: ObjectType.TABLE,
          undo: { fields: tables.find((t) => t.id === table.id).fields },
          redo: { fields: table.fields },
        })),
      },
    ]);
    setRedoStack([]);
    setExportData((prev) => {
      const protoSource = { ...prev.protoSource, tables: numbered };
      const { proto, issues } = generateProtobuf(
        protoSource,
        prev.protoOptions,
      );
      return { ...prev, protoSource, data: proto, protoIssues: issues };
    });
  };

  const hasExportSettings = Boolean(
    (exportData.extension === "sql" &&
      (exportData.sqlSource || exportData.migrationSource)) ||
      (exportData.extension === "proto" && exportData.protoSource) ||
      (exportData.extension === "hpp" && exportData.cppSource),
  );

  // Rebuilds the migration script for a dialect and settings.
  const rebuildMigration = (dialect, migrationOptions) =>
    setExportData((prev) => {
      const { before, after, from, to } = prev.migrationSource;
      const { sql, issues } = generateMigration(before, after, {
        dialect,
        options: migrationOptions,
        from,
        to,
      });
      return {
        ...prev,
        data: sql,
        migrationDialect: dialect,
        migrationOptions,
        migrationIssues: issues,
      };
    });

  const getModalBody = () => {
    switch (modal) {
      case MODAL.IMPORT:
        return (
          <ImportDiagram
            setImportData={setImportData}
            error={error}
            setError={setError}
            importFrom={importFrom}
          />
        );
      case MODAL.IMPORT_SRC:
        return (
          <ImportSource
            importData={importSource}
            setImportData={setImportSource}
            error={error}
            setError={setError}
          />
        );
      case MODAL.NEW:
        return (
          <New
            selectedTemplateId={selectedTemplateId}
            setSelectedTemplateId={setSelectedTemplateId}
          />
        );
      case MODAL.RENAME:
        return (
          <Rename key={title} title={title} setTitle={setUncontrolledTitle} />
        );
      case MODAL.OPEN:
        return (
          <Open
            selectedDiagramId={selectedDiagramId}
            setSelectedDiagramId={setSelectedDiagramId}
          />
        );
      case MODAL.SAVEAS:
        return (
          <Input
            placeholder={t("name")}
            value={saveAsTitle}
            onChange={(v) => setSaveAsTitle(v)}
          />
        );
      case MODAL.CODE:
      case MODAL.IMG:
        if (exportData.data !== "" || exportData.data) {
          const settings = modal === MODAL.CODE && hasExportSettings && (
            <>
              {modal === MODAL.CODE &&
                exportData.extension === "sql" &&
                exportData.sqlSource && (
                  <>
                    <ExportIssues
                      issues={exportData.sqlIssues}
                      prefix="sql_issue"
                      format={formatIssue}
                    />
                    <ExportOptions
                      prefix="sql_opt"
                      defs={sqlOptionDefsFor(
                        exportData.sqlDialect,
                        exportData.sqlSource.database,
                      )}
                      values={{
                        ...defaultSqlOptions(exportData.sqlDialect),
                        ...exportData.sqlOptions,
                      }}
                      onChange={(sqlOptions) => {
                        saveExportOptions(
                          `sql.${exportData.sqlDialect}`,
                          sqlOptions,
                        );
                        setExportData((prev) => {
                          const { sql, issues } = generateSQL(prev.sqlSource, {
                            dialect: prev.sqlDialect,
                            options: sqlOptions,
                          });
                          return {
                            ...prev,
                            sqlOptions,
                            data: sql,
                            sqlIssues: issues,
                          };
                        });
                      }}
                    />
                  </>
                )}
              {modal === MODAL.CODE &&
                exportData.extension === "sql" &&
                exportData.migrationSource && (
                  <>
                    {exportData.migrationSource.after.database ===
                      DB.GENERIC && (
                      <div className="flex items-center justify-between gap-4 py-1.5 px-1">
                        <span className="text-sm">{t("database")}</span>
                        <Select
                          size="small"
                          className="w-56"
                          value={exportData.migrationDialect}
                          optionList={Object.values(DB)
                            .filter((db) => db !== DB.GENERIC)
                            .map((db) => ({
                              value: db,
                              label: databases[db].name,
                            }))}
                          onChange={(dialect) =>
                            rebuildMigration(
                              dialect,
                              loadExportOptions(`migration.${dialect}`),
                            )
                          }
                        />
                      </div>
                    )}
                    <ExportIssues
                      issues={exportData.migrationIssues}
                      prefix="sql_issue"
                      format={formatIssue}
                    />
                    <ExportOptions
                      prefix="sql_opt"
                      defs={migrationOptionDefsFor(
                        exportData.migrationDialect,
                        exportData.migrationSource.after.database,
                      )}
                      values={{
                        ...defaultMigrationOptions(exportData.migrationDialect),
                        ...exportData.migrationOptions,
                      }}
                      onChange={(migrationOptions) => {
                        saveExportOptions(
                          `migration.${exportData.migrationDialect}`,
                          migrationOptions,
                        );
                        rebuildMigration(
                          exportData.migrationDialect,
                          migrationOptions,
                        );
                      }}
                    />
                  </>
                )}
              {modal === MODAL.CODE &&
                exportData.extension === "hpp" &&
                exportData.cppSource && (
                  <>
                    <ExportIssues
                      issues={exportData.cppIssues}
                      prefix="cpp_issue"
                      format={formatCppIssue}
                    />
                    <ExportOptions
                      prefix="cpp_opt"
                      defs={CPP_OPTION_DEFS.map((def) =>
                        def.key === "namespaceName"
                          ? {
                              ...def,
                              placeholder:
                                generateCpp(exportData.cppSource).code.match(
                                  /^namespace (\S+) \{$/m,
                                )?.[1] ?? "",
                            }
                          : def,
                      )}
                      values={{
                        ...defaultCppOptions,
                        ...exportData.cppOptions,
                      }}
                      onChange={(cppOptions) => {
                        saveExportOptions("cpp", cppOptions);
                        setExportData((prev) => {
                          const { code, issues } = generateCpp(
                            prev.cppSource,
                            cppOptions,
                          );
                          return {
                            ...prev,
                            cppOptions,
                            data: code,
                            cppIssues: issues,
                          };
                        });
                      }}
                    />
                  </>
                )}
              {modal === MODAL.CODE &&
                exportData.extension === "proto" &&
                exportData.protoSource && (
                  <>
                    <ExportIssues
                      issues={exportData.protoIssues}
                      prefix="proto_issue"
                      format={formatProtoIssue}
                    />
                    {exportData.protoIssues?.some(
                      (issue) => issue.code === "numbers_not_saved",
                    ) &&
                      !layout.readOnly && (
                        <div className="mt-2 text-xs">
                          <Button size="small" onClick={saveProtoNumbers}>
                            {t("proto_save_numbers")}
                          </Button>
                          <div className="opacity-60 mt-1">
                            {t("proto_save_numbers_hint")}
                          </div>
                        </div>
                      )}
                    <ExportOptions
                      prefix="proto_opt"
                      defs={PROTO_OPTION_DEFS.map((def) =>
                        def.key === "packageName"
                          ? {
                              ...def,
                              placeholder:
                                generateProtobuf(
                                  exportData.protoSource,
                                ).proto.match(/^package (.+);$/m)?.[1] ?? "",
                            }
                          : def,
                      )}
                      values={{
                        ...defaultProtobufOptions,
                        ...exportData.protoOptions,
                      }}
                      onChange={(protoOptions) => {
                        saveExportOptions("proto", protoOptions);
                        setExportData((prev) => {
                          const { proto, issues } = generateProtobuf(
                            prev.protoSource,
                            protoOptions,
                          );
                          return {
                            ...prev,
                            protoOptions,
                            data: proto,
                            protoIssues: issues,
                          };
                        });
                      }}
                    />
                  </>
                )}
            </>
          );
          return (
            <>
              {modal === MODAL.IMG ? (
                <Image src={exportData.data} alt="Diagram" height={280} />
              ) : (
                <div className={settings ? "flex gap-4 sm:flex-col" : ""}>
                  <div className={settings ? "flex-1 min-w-0" : ""}>
                    <CodeEditor
                      height={settings ? 470 : 360}
                      value={exportData.data}
                      language={extensionToLanguage[exportData.extension]}
                      options={{ readOnly: true }}
                      showCopyButton={true}
                    />
                  </div>
                  {settings && (
                    <div
                      className="w-[380px] sm:w-full shrink-0 overflow-y-auto pe-1"
                      style={{ maxHeight: 470 }}
                    >
                      {settings}
                    </div>
                  )}
                </div>
              )}
              <div className="text-sm font-semibold mt-2">{t("filename")}:</div>
              <Input
                value={exportData.filename}
                placeholder={t("filename")}
                suffix={<div className="p-2">{`.${exportData.extension}`}</div>}
                onChange={(value) =>
                  setExportData((prev) => ({ ...prev, filename: value }))
                }
                field="filename"
              />
            </>
          );
        } else {
          return (
            <div className="text-center my-3 text-sky-600">
              <Spin tip={t("loading")} size="large" />
            </div>
          );
        }
      case MODAL.TABLE_WIDTH:
        return (
          <SetTableWidth
            tempWidth={tempTableWidth}
            setTempWidth={setTempTableWidth}
          />
        );
      case MODAL.LANGUAGE:
        return (
          <Language
            language={uncontrolledLanguage}
            setLanguage={setUncontrolledLanguage}
          />
        );
      default:
        return <></>;
    }
  };

  return (
    <SemiUIModal
      style={isRtl(i18n.language) ? { direction: "rtl" } : {}}
      title={getModalTitle(modal)}
      visible={modal !== MODAL.NONE && modal !== MODAL.CONFIG_CUSTOM_TYPES}
      onOk={getModalOnOk}
      afterClose={() => {
        setExportData(() => ({
          data: "",
          extension: "",
          filename: `${title}_${new Date().toISOString()}`,
        }));
        setError({
          type: STATUS.NONE,
          message: "",
        });
        setImportData(null);
        setImportSource({
          src: "",
          overwrite: false,
        });
      }}
      onCancel={() => {
        if (modal === MODAL.RENAME) setUncontrolledTitle(title);
        if (modal === MODAL.LANGUAGE) setUncontrolledLanguage(i18n.language);
        if (modal === MODAL.TABLE_WIDTH) setTempTableWidth(settings.tableWidth);
        setModal(MODAL.NONE);
      }}
      centered
      closeOnEsc={true}
      okText={getOkText(modal)}
      okButtonProps={{
        disabled:
          (error && error?.type === STATUS.ERROR) ||
          (modal === MODAL.IMPORT &&
            (error.type === STATUS.ERROR || !importData)) ||
          (modal === MODAL.RENAME && title === "") ||
          ((modal === MODAL.IMG || modal === MODAL.CODE) && !exportData.data) ||
          (modal === MODAL.SAVEAS && saveAsTitle === "") ||
          (modal === MODAL.IMPORT_SRC && importSource.src === ""),
      }}
      hasCancel
      cancelText={t("cancel")}
      width={
        modal === MODAL.CODE && hasExportSettings
          ? Math.min(1180, window.innerWidth - 32)
          : getModalWidth(modal)
      }
      bodyStyle={{
        maxHeight: window.innerHeight - 280,
        overflow: modal === MODAL.IMG ? "hidden" : "auto",
        direction: "ltr",
      }}
    >
      {getModalBody()}
    </SemiUIModal>
  );
}
