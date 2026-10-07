const spanish = {
  name: "Spanish",
  native_name: "Español",
  code: "es",
};

const es = {
  translation: {
    report_bug: "Reportar error",
    import: "Importar",
    inherits: "Hereda",
    merging_column_w_inherited_definition:
      "La columna '{{fieldName}}' en la tabla '{{tableName}}' con definición heredada será fusionada",
    import_from: "Importar desde",
    file: "Archivo",
    new: "Nuevo",
    new_window: "Nueva ventana",
    no_saved_diagrams: "No tienes diagramas guardados",
    open: "Abrir",
    open_recent: "Abrir reciente(s)",
    save: "Guardar",
    save_as: "Guardar como",
    save_as_template: "Guardar como plantilla",
    template_saved: "¡Plantilla guardada!",
    rename: "Renombrar",
    delete_diagram: "Eliminar diagrama",
    are_you_sure_delete_diagram:
      "¿Estás seguro de que quieres eliminar este diagrama? Esta operación es irreversible.",
    oops_smth_went_wrong: "Ups! Algo salió mal.",
    import_diagram: "Importar diagrama",
    import_from_source: "Importar desde SQL",
    export_as: "Exportar como",
    export_source: "Exportar SQL",
    models: "Modelos",
    exit: "Salir",
    edit: "Editar",
    undo: "Deshacer",
    redo: "Rehacer",
    clear: "Limpiar",
    are_you_sure_clear:
      "¿Estás seguro de que quieres borrar el diagrama? Esto es irreversible.",
    cut: "Cortar",
    copy: "Copiar",
    paste: "Pegar",
    duplicate: "Duplicar",
    delete: "Eliminar",
    copy_as_image: "Copiar como imagen",
    view: "Ver",
    header: "Encabezado",
    sidebar: "Barra lateral",
    issues: "Problemas",
    presentation_mode: "Modo de presentación",
    strict_mode: "Modo estricto",
    field_details: "Detalles del campo",
    reset_view: "Restablecer vista",
    show_grid: "Mostrar cuadrícula",
    snap_to_grid: "Ajustar a la cuadrícula",
    show_datatype: "Mostrar tipo de datos",
    show_cardinality: "Mostrar cardinalidad",
    show_comments: "Mostrar comentarios",
    theme: "Tema",
    light: "Claro",
    dark: "Oscuro",
    zoom_in: "Acercar",
    zoom_out: "Alejar",
    fullscreen: "Pantalla completa",
    settings: "Configuración",
    show_timeline: "Mostrar línea de tiempo",
    autosave: "Guardado automático",
    panning: "Desplazamiento",
    show_debug_coordinates: "Mostrar coordenadas de depuración",
    transform: "Transformar",
    viewbox: "Cuadro de visualización",
    cursor_coordinates: "Coordenadas del cursor",
    coordinate_space: "Espacio de coordenadas",
    coordinate_space_screen: "Espacio de coordenadas de pantalla",
    coordinate_space_diagram: "Espacio de coordenadas de diagrama",
    table_width: "Ancho de la tabla",
    language: "Idioma",
    flush_storage: "Vaciar almacenamiento",
    are_you_sure_flush_storage:
      "¿Estás seguro de que quieres vaciar el almacenamiento? Esta operación es irreversible.",
    storage_flushed: "¡Almacenamiento vaciado!",
    help: "Ayuda",
    source_code: "Código fuente",
    third_party_licenses: "Licencias de terceros",
    shortcuts: "Atajos",
    ask_on_discord: "Pregúntanos en Discord",
    feedback: "Retroalimentación",
    no_changes: "Sin cambios",
    loading: "Cargando...",
    last_saved: "Último guardado",
    saving: "Guardando...",
    failed_to_save: "Error al guardar",
    fit_window_reset: "Ajustar ventana / Restablecer",
    zoom: "Zoom",
    add_table: "Añadir tabla",
    add_area: "Añadir área",
    add_note: "Añadir nota",
    add_type: "Añadir tipo",
    to_do: "Por hacer",
    tables: "Tablas",
    relationships: "Relaciones",
    subject_areas: "Áreas de tema",
    notes: "Notas",
    types: "Tipos",
    search: "Buscar...",
    no_tables: "Sin tablas",
    no_tables_text: "¡Comienza a construir tu diagrama!",
    no_relationships: "Sin relaciones",
    no_relationships_text:
      "¡Arrastra para conectar campos y formar relaciones!",
    no_subject_areas: "Sin áreas de tema",
    no_subject_areas_text: "¡Añade áreas de tema para agrupar tablas!",
    no_notes: "Sin notas",
    no_notes_text: "Usa notas para registrar información extra",
    no_types: "Sin tipos",
    no_types_text: "¡Crea tipos de datos personalizados!",
    no_issues: "No se detectaron problemas",
    strict_mode_is_on_no_issues:
      "El modo estricto está desactivado, por lo que no se mostrarán problemas.",
    name: "Nombre",
    type: "Tipo",
    null: "Nulo",
    not_null: "No nulo",
    nullable: "Anulable",
    primary: "Primario",
    unique: "Único",
    autoincrement: "Autoincremental",
    default_value: "Valor predeterminado",
    check: "Expresión de verificación",
    this_will_appear_as_is: "*Esto aparecerá en el script generado tal cual.",
    comment: "Comentario",
    add_field: "Agregar campo",
    values: "valores",
    size: "Tamaño",
    precision: "Precisión",
    set_precision: "Establecer precisión: (tamaño, dígitos)",
    use_for_batch_input: "Usar ',' para entrada por lotes",
    indices: "Índices",
    add_index: "Agregar índice",
    select_fields: "Seleccionar campos",
    title: "Título",
    not_set: "No establecido",
    foreign: "Foránea",
    cardinality: "Cardinalidad",
    on_update: "Al actualizar",
    on_delete: "Al eliminar",
    swap: "Intercambiar",
    one_to_one: "Uno a uno",
    one_to_many: "Uno a muchos",
    many_to_one: "Muchos a uno",
    content: "Contenido",
    types_info:
      "Esta característica está destinada a DBMSs objeto-relacionales como PostgreSQL.\nSi se usa para MySQL o MariaDB, se generará un tipo JSON con la validación JSON correspondiente.\nSi se usa para SQLite, se traducirá a un BLOB.\nSi se usa para MSSQL, se generará un alias de tipo al primer campo.",
    table_deleted: "Tabla eliminada",
    area_deleted: "Área eliminada",
    note_deleted: "Nota eliminada",
    relationship_deleted: "Relación eliminada",
    type_deleted: "Tipo eliminado",
    cannot_connect:
      "No se puede conectar, las columnas tienen diferentes tipos",
    copied_to_clipboard: "Copiado al portapapeles",
    create_new_diagram: "Crear nuevo diagrama",
    cancel: "Cancelar",
    open_diagram: "Abrir diagrama",
    rename_diagram: "Renombrar diagrama",
    export: "Exportar",
    export_image: "Exportar imagen",
    create: "Crear",
    confirm: "Confirmar",
    last_modified: "Última modificación",
    drag_and_drop_files:
      "Arrastra y suelta el archivo aquí o haz clic para subir.",
    upload_sql_to_generate_diagrams:
      "Sube un archivo SQL para autogenerar tus tablas y columnas.",
    overwrite_existing_diagram: "Sobrescribir diagrama existente",
    only_mysql_supported:
      "*Por el momento, solo se admite la carga de scripts de MySQL.",
    blank: "En blanco",
    filename: "Nombre del archivo",
    export_advanced: "Avanzado",
    export_review: "Revisión",
    proto_field_number: "Nº de campo Protobuf",
    proto_field_number_hint:
      "No reutilices un número una vez enviados mensajes.",
    proto_field_number_auto: "auto",
    proto_save_numbers: "Guardar la numeración en el diagrama",
    proto_save_numbers_hint:
      "Guarda en cada columna el número que se muestra. Desde entonces, añadir, mover o borrar columnas conserva los números existentes, y los de columnas borradas quedan reservados.",
    proto_opt_packageName: "Paquete",
    proto_opt_packageName_desc:
      "Paquete del fichero .proto. Vacío usa el nombre del diagrama.",
    proto_opt_fieldCase: "Nombres de campo",
    proto_opt_fieldCase_desc:
      "Cómo se escriben las columnas como campos. snake_case es el estilo oficial de Protobuf.",
    proto_opt_fieldCase_snake: "snake_case",
    proto_opt_fieldCase_camel: "camelCase",
    proto_opt_fieldCase_original: "Mantener original",
    proto_opt_fieldNumbers: "Números de campo",
    proto_opt_fieldNumbers_desc:
      "Guardados conserva los números almacenados en el diagrama, para que los datos serializados sigan leyéndose cuando cambian las columnas. Por posición renumera 1, 2, 3… cada vez.",
    proto_opt_fieldNumbers_stored: "Guardados en el diagrama",
    proto_opt_fieldNumbers_position: "Por posición",
    proto_opt_nullableAsOptional: "Columnas nulas como optional",
    proto_opt_nullableAsOptional_desc:
      "Las columnas que admiten NULL pasan a campos optional, para distinguir «sin valor» de 0 o de una cadena vacía.",
    proto_opt_includeComments: "Comentarios",
    proto_opt_includeComments_desc:
      "Copia los comentarios de tablas y columnas al fichero .proto.",
    proto_opt_service: "Servicio gRPC",
    proto_opt_service_desc:
      "Añade también un servicio con Get, List, Create, Update y Delete por cada tabla.",
    proto_opt_service_none: "Ninguno",
    proto_opt_service_crud: "CRUD por tabla",
    proto_opt_goPackage: "go_package",
    proto_opt_goPackage_desc:
      "Ruta de importación del código Go generado. Vacío omite la opción.",
    proto_opt_javaPackage: "java_package",
    proto_opt_javaPackage_desc:
      "Paquete Java de las clases generadas. Vacío omite la opción.",
    proto_opt_javaMultipleFiles: "java_multiple_files",
    proto_opt_javaMultipleFiles_desc:
      "Un fichero Java por mensaje (solo con paquete Java).",
    proto_opt_optimizeFor: "optimize_for",
    proto_opt_optimizeFor_desc:
      "Generación de código C++/Java: SPEED (valor por defecto de protoc), CODE_SIZE o LITE_RUNTIME para la librería reducida libprotobuf-lite.",
    proto_opt_optimizeFor_default: "No indicar",
    proto_opt_optimizeFor_SPEED: "SPEED",
    proto_opt_optimizeFor_CODE_SIZE: "CODE_SIZE",
    proto_opt_optimizeFor_LITE_RUNTIME: "LITE_RUNTIME",
    proto_opt_messageCase: "Nombres de mensaje",
    proto_opt_messageCase_desc: "Cómo se escriben las tablas como mensajes.",
    proto_opt_messageCase_pascal: "PascalCase",
    proto_opt_messageCase_original: "Mantener original",
    proto_opt_singularizeMessages: "Mensajes en singular",
    proto_opt_singularizeMessages_desc: "users → User (reglas del inglés).",
    proto_opt_messageSuffix: "Sufijo de mensaje",
    proto_opt_messageSuffix_desc:
      "Se añade a cada mensaje de tabla, por ejemplo Dto o Entity.",
    proto_opt_enumValueStyle: "Valores de enum",
    proto_opt_enumValueStyle_desc:
      "Prefijar con el nombre del enum (STATUS_PAID) evita colisiones; los valores que comparten ámbito se prefijan de todas formas si chocarían.",
    proto_opt_enumValueStyle_prefixed: "STATUS_PAID",
    proto_opt_enumValueStyle_plain: "PAID",
    proto_opt_enumZeroName: "Nombre del valor cero",
    proto_opt_enumZeroName_desc:
      "Los enums de proto3 empiezan por un valor 0 que significa «sin valor»; se escribe como <ENUM>_<este nombre>.",
    proto_opt_unsignedAs: "Enteros UNSIGNED",
    proto_opt_unsignedAs_desc:
      "uint32/uint64 cubren todo el rango de una columna UNSIGNED; int32/int64 encajan con código con signo.",
    proto_opt_unsignedAs_uint: "uint32 / uint64",
    proto_opt_unsignedAs_int: "int32 / int64",
    proto_opt_decimalAs: "DECIMAL / NUMERIC",
    proto_opt_decimalAs_desc:
      "string conserva los decimales exactos; double pierde precisión.",
    proto_opt_decimalAs_string: "string",
    proto_opt_decimalAs_double: "double",
    proto_opt_timestampAs: "TIMESTAMP / DATETIME",
    proto_opt_timestampAs_desc:
      "Cómo se transportan las columnas de fecha y hora.",
    proto_opt_timestampAs_timestamp: "google.protobuf.Timestamp",
    proto_opt_timestampAs_int64: "int64 (epoch)",
    proto_opt_timestampAs_string: "string (ISO 8601)",
    proto_opt_dateAs: "DATE",
    proto_opt_dateAs_desc:
      "google.type.Date necesita google/type/date.proto de googleapis junto a protoc.",
    proto_opt_dateAs_string: "string",
    proto_opt_dateAs_google_date: "google.type.Date",
    proto_opt_jsonAs: "JSON / JSONB",
    proto_opt_jsonAs_desc: "Value admite cualquier JSON; Struct solo objetos.",
    proto_opt_jsonAs_value: "google.protobuf.Value",
    proto_opt_jsonAs_struct: "google.protobuf.Struct",
    proto_opt_jsonAs_string: "string",
    proto_opt_uuidAs: "UUID",
    proto_opt_uuidAs_desc: "string (36 caracteres) o bytes (16).",
    proto_opt_uuidAs_string: "string",
    proto_opt_uuidAs_bytes: "bytes",
    proto_opt_includeConstraintComments: "Anotar claves y valores por defecto",
    proto_opt_includeConstraintComments_desc:
      "Indica en un comentario la clave primaria, única, autoincremento, clave foránea y valor por defecto de cada columna.",
    proto_issue_name_clash:
      "{{kind}} {{name}} repetiría otra definición; se exportó como {{newName}}.",
    proto_issue_enum_values_prefixed:
      "Los valores de {{name}} se prefijaron porque otro enum del mismo ámbito usa los mismos nombres.",
    proto_issue_json_name_clash:
      "{{message}}.{{field}} se confunde con otro campo al escribirse en camelCase (JSON); se exportó como {{newName}}.",
    proto_issue_number_invalid:
      "{{message}}.{{field}}: el número guardado {{number}} no es válido o ya se usa; se usó {{newNumber}}.",
    proto_issue_numbers_not_saved:
      "{{count}} campos no tienen número guardado, así que su número depende del orden de las columnas. Guarda la numeración en el diagrama para fijarla.",
    proto_issue_google_date:
      "google.type.Date no viene con protoc; necesita google/type/date.proto de googleapis.",
    sql_opt_existing: "Si los objetos ya existen",
    sql_opt_existing_desc:
      "Qué hace el script en una base de datos que ya tiene estas tablas.",
    sql_opt_existing_create: "Fallar (CREATE normal)",
    sql_opt_existing_if_not_exists: "Conservarlos (IF NOT EXISTS)",
    sql_opt_existing_drop_create: "Borrar y recrear (elimina datos)",
    sql_opt_foreignKeys: "Claves foráneas",
    sql_opt_foreignKeys_desc:
      "Dentro de CREATE TABLE o añadidas al final con ALTER TABLE. Automático elige lo que mejor funciona en esta base de datos.",
    sql_opt_foreignKeys_auto: "Automático",
    sql_opt_foreignKeys_alter: "ALTER TABLE al final",
    sql_opt_foreignKeys_inline: "Dentro de CREATE TABLE",
    sql_opt_foreignKeys_none: "No incluir",
    sql_opt_includeComments: "Comentarios",
    sql_opt_includeComments_desc:
      "Comentarios de tablas y columnas (COMMENT, COMMENT ON o propiedades extendidas).",
    sql_opt_includeIndexes: "Índices",
    sql_opt_includeIndexes_desc:
      "Los índices dibujados en cada tabla. Las claves primarias y únicas se incluyen siempre.",
    sql_opt_schema: "Esquema",
    sql_opt_schema_desc:
      "Antepone este esquema a cada objeto (la base de datos en MySQL, el propietario en Oracle). Vacío usa el de la conexión.",
    sql_opt_wrapInTransaction: "Una sola transacción",
    sql_opt_wrapInTransaction_desc:
      "Ejecuta todo el script entre BEGIN y COMMIT: se aplica entero o no se aplica.",
    sql_opt_nameConstraints: "Nombrar restricciones",
    sql_opt_nameConstraints_desc:
      "Da nombre explícito a claves primarias, únicas y foráneas (pk_…, uq_…, el nombre de la relación) en vez de dejar que la base de datos lo invente. Así las migraciones posteriores pueden referirse a ellas.",
    sql_opt_pkNamePattern: "Nombre de la clave primaria",
    sql_opt_pkNamePattern_desc:
      "Patrón del nombre de las claves primarias. {table} se sustituye por el nombre de la tabla.",
    sql_opt_identifierQuoting: "Entrecomillar nombres",
    sql_opt_identifierQuoting_desc:
      "Siempre conserva cada nombre exactamente como se dibujó. Solo si hace falta deja sin comillas los nombres simples (Oracle los guarda entonces en mayúsculas).",
    sql_opt_identifierQuoting_always: "Siempre",
    sql_opt_identifierQuoting_when_needed: "Solo si hace falta",
    sql_opt_tableOrder: "Orden de las tablas",
    sql_opt_tableOrder_desc:
      "Dependencias primero crea las tablas referenciadas antes que las que apuntan a ellas.",
    sql_opt_tableOrder_dependencies: "Dependencias primero",
    sql_opt_tableOrder_diagram: "Como en el diagrama",
    sql_opt_tableOrder_alphabetical: "Alfabético",
    sql_opt_identityGeneration: "Columnas de identidad",
    sql_opt_identityGeneration_desc:
      "BY DEFAULT admite valores explícitos (útil para migrar datos); ALWAYS los rechaza.",
    sql_opt_identityGeneration_by_default: "GENERATED BY DEFAULT",
    sql_opt_identityGeneration_always: "GENERATED ALWAYS",
    sql_opt_includeChecks: "Restricciones CHECK",
    sql_opt_includeChecks_desc:
      "Las expresiones CHECK escritas en las columnas y las que emulan ENUM, BOOLEAN o JSON donde la base de datos no los tiene.",
    sql_opt_includeHeader: "Comentario de cabecera",
    sql_opt_includeHeader_desc:
      "Una primera línea que indica para qué base de datos es el script.",
    sql_opt_createSchema: "Crear el esquema",
    sql_opt_createSchema_desc:
      "Crea el esquema (la base de datos en MySQL) si no existe. Solo se usa si hay un esquema indicado.",
    sql_opt_mysqlEngine: "Motor de almacenamiento",
    sql_opt_mysqlEngine_desc:
      "ENGINE de cada tabla. Las claves foráneas necesitan InnoDB. Vacío usa el del servidor.",
    sql_opt_mysqlCharset: "Juego de caracteres",
    sql_opt_mysqlCharset_desc:
      "DEFAULT CHARSET de cada tabla. Vacío usa el del servidor.",
    sql_opt_mysqlCollation: "Intercalación (collation)",
    sql_opt_mysqlCollation_desc:
      "COLLATE de cada tabla. Vacío usa la del juego de caracteres.",
    sql_opt_mysqlIndexPrefix: "Prefijo de clave en columnas de texto",
    sql_opt_mysqlIndexPrefix_desc:
      "MySQL solo indexa los primeros caracteres de las columnas TEXT y BLOB; se usan estos en claves e índices.",
    sql_opt_jsonSchemaChecks: "Validar tipos personalizados",
    sql_opt_jsonSchemaChecks_desc:
      "Las columnas de un tipo personalizado pasan a JSON con un CHECK (JSON_SCHEMA_VALID) que describe sus campos (MySQL 8.0.17+).",
    sql_opt_uuidAs: "Columnas UUID",
    sql_opt_uuidAs_desc:
      "Nativo usa el tipo UUID propio de la base de datos si lo tiene (PostgreSQL, SQL Server, MariaDB 10.7+). Texto guarda 36 caracteres; binario, 16 bytes.",
    sql_opt_uuidAs_native: "Tipo nativo",
    sql_opt_uuidAs_string: "Texto (36)",
    sql_opt_uuidAs_binary: "Binario (16)",
    sql_opt_pgCreateExtensions: "Crear extensiones",
    sql_opt_pgCreateExtensions_desc:
      "Añade CREATE EXTENSION para los tipos que la necesitan (vector). Requiere permiso para crear extensiones.",
    sql_opt_sqliteForeignKeysPragma: "Activar claves foráneas",
    sql_opt_sqliteForeignKeysPragma_desc:
      "Añade PRAGMA foreign_keys = ON. SQLite ignora las claves foráneas si cada conexión no las activa.",
    sql_opt_sqliteAutoincrement: "Palabra clave AUTOINCREMENT",
    sql_opt_sqliteAutoincrement_desc:
      "No reutiliza nunca los ids de filas borradas. Sin ella, una INTEGER PRIMARY KEY se numera igualmente sola.",
    sql_opt_mssqlBatchSeparator: "Separadores GO",
    sql_opt_mssqlBatchSeparator_desc:
      "Divide el script en lotes para SSMS y sqlcmd. Desactívalo para ejecutarlo con un driver (ODBC, JDBC…).",
    sql_opt_mssqlNativeJson: "Tipo JSON nativo",
    sql_opt_mssqlNativeJson_desc:
      "Usa el tipo JSON de SQL Server 2025. Desactivado, las columnas JSON son NVARCHAR(MAX) con ISJSON (2016+).",
    sql_opt_oracleBoolean: "Columnas BOOLEAN",
    sql_opt_oracleBoolean_desc:
      "NUMBER(1) limitado a 0/1 funciona en todas las versiones; el BOOLEAN nativo necesita Oracle 23ai.",
    sql_opt_oracleBoolean_number: "NUMBER(1)",
    sql_opt_oracleBoolean_native: "BOOLEAN (23ai)",
    sql_issue_empty_table_name:
      "Una tabla no tiene nombre; se exportó como {{table}}.",
    sql_issue_empty_column_name:
      "Una columna de {{table}} no tiene nombre; se exportó como {{column}}.",
    sql_issue_duplicate_table: "Hay dos tablas llamadas {{table}}.",
    sql_issue_duplicate_column:
      "{{table}} tiene dos columnas llamadas {{column}}.",
    sql_issue_name_too_long:
      "{{name}} supera los {{max}} bytes que {{dialect}} admite para un nombre.",
    sql_issue_name_changed:
      "{{name}} se renombró a {{newName}} para que los nombres no se repitan.",
    sql_issue_oracle_quote_in_name:
      "Los nombres de Oracle no pueden contener comillas dobles; se cambió {{name}}.",
    sql_issue_empty_type:
      "{{table}}.{{column}} no tiene tipo; se usó {{type}}.",
    sql_issue_type_not_for_columns:
      "{{table}}.{{column}}: {{type}} no puede ser el tipo de una columna en {{dialect}}.",
    sql_issue_size_ignored:
      "{{table}}.{{column}}: {{type}} no admite tamaño en {{dialect}}; se omitió ({{size}}).",
    sql_issue_size_invalid:
      "{{table}}.{{column}}: ({{size}}) no es un tamaño válido para {{type}} y se omitió.",
    sql_issue_size_filled:
      "{{table}}.{{column}}: {{type}} necesita longitud en {{dialect}}; se usó {{size}}.",
    sql_issue_enum_no_values:
      "{{table}}.{{column}} es un {{type}} sin valores; se usó {{fallback}}.",
    sql_issue_enum_duplicate_value:
      "{{name}} repite el valor '{{value}}'; se eliminó la repetición.",
    sql_issue_enum_no_values_type:
      "El enum {{name}} no tiene valores y no se incluyó.",
    sql_issue_set_value_comma:
      "{{table}}.{{column}}: los valores de un SET no pueden contener comas.",
    sql_issue_set_emulated:
      "{{table}}.{{column}}: {{dialect}} no tiene tipo SET; se exportó como texto con valores separados por comas.",
    sql_issue_type_name_clash:
      "El tipo {{name}} se llama igual que una tabla, y PostgreSQL no lo permite.",
    sql_issue_identity_unsupported_type:
      "{{table}}.{{column}}: {{type}} no puede ser autoincremental en {{dialect}}; se omitió el autoincremento.",
    sql_issue_identity_multiple:
      "{{table}} tiene más de una columna autoincremental; {{dialect}} solo admite una, así que solo la conserva {{column}}.",
    sql_issue_sqlite_autoincrement:
      "{{table}}.{{column}}: SQLite solo autoincrementa una única columna INTEGER PRIMARY KEY; se omitió el autoincremento.",
    sql_issue_mysql_autoincrement_key:
      "{{table}}.{{column}} es autoincremental pero no es clave; se añadió un índice porque MySQL lo exige.",
    sql_issue_default_on_identity:
      "{{table}}.{{column}} es autoincremental, así que se omitió su valor por defecto.",
    sql_issue_default_on_rowversion:
      "{{table}}.{{column}} es una versión de fila y no puede tener valor por defecto.",
    sql_issue_default_null_not_null:
      "{{table}}.{{column}} es NOT NULL, así que se omitió DEFAULT NULL.",
    sql_issue_default_not_numeric:
      "{{table}}.{{column}}: el valor por defecto '{{value}}' no es un número.",
    sql_issue_default_not_boolean:
      "{{table}}.{{column}}: el valor por defecto '{{value}}' no es un booleano.",
    sql_issue_default_not_bits:
      "{{table}}.{{column}}: el valor por defecto '{{value}}' no es una cadena de bits.",
    sql_issue_default_not_in_enum:
      "{{table}}.{{column}}: el valor por defecto '{{value}}' no está entre los valores permitidos.",
    sql_issue_check_ignored_type:
      "{{table}}.{{column}}: {{type}} no admite CHECK, así que se omitió.",
    sql_issue_check_copied:
      "Las expresiones CHECK se copian tal cual ({{columns}}); comprueba que solo usan funciones que existen en {{dialect}}.",
    sql_issue_check_on_identity:
      "{{table}}.{{column}}: las columnas autoincrementales no admiten CHECK en {{dialect}}; se omitió.",
    sql_issue_stale_column_reference:
      "{{table}}: {{object}} hace referencia a la columna inexistente {{column}} y no se incluyó.",
    sql_issue_empty_index:
      "{{table}}: {{object}} no tiene columnas y no se incluyó.",
    sql_issue_duplicate_key:
      "{{table}}: {{object}} repite las columnas de {{other}} y no se incluyó.",
    sql_issue_lob_in_key:
      "{{table}}: {{column}} ({{type}}) no puede formar parte de {{object}} en {{dialect}}.",
    sql_issue_mysql_prefix_key:
      "{{table}}: {{column}} es de tipo {{type}}, así que {{object}} indexa solo sus primeros {{prefix}} caracteres.",
    sql_issue_no_primary_key: "{{table}} no tiene clave primaria.",
    sql_issue_fk_missing_table:
      "La relación {{name}} apunta a una tabla que no existe y no se incluyó.",
    sql_issue_fk_missing_column:
      "La relación {{name}} apunta a una columna que no existe y no se incluyó.",
    sql_issue_fk_target_not_unique:
      "La relación {{name}} referencia {{table}}({{columns}}), que no es su clave primaria ni una clave única.",
    sql_issue_fk_type_mismatch:
      "La relación {{name}} une {{column}} ({{type}}) con {{refColumn}} ({{refType}}); {{dialect}} necesita tipos compatibles.",
    sql_issue_fk_set_null_not_null:
      "La relación {{name}} usa SET NULL pero {{column}} es NOT NULL.",
    sql_issue_fk_set_default_unsupported:
      "La relación {{name}} usa SET DEFAULT, que {{dialect}} no admite; se omitió.",
    sql_issue_fk_set_default_innodb:
      "La relación {{name}} usa SET DEFAULT, que InnoDB acepta pero no aplica.",
    sql_issue_fk_restrict_mapped:
      "La relación {{name}} usa RESTRICT; en {{dialect}} se llama NO ACTION.",
    sql_issue_oracle_no_on_update:
      "La relación {{name}} usa ON UPDATE {{action}}, que Oracle no admite; se omitió.",
    sql_issue_mssql_cascade_paths:
      "La relación {{name}} crea ciclos o varias rutas de cascada, que SQL Server rechaza. Usa NO ACTION en alguna de ellas.",
    sql_issue_fk_inline_cycle:
      "{{table}} forma parte de un ciclo de claves foráneas; su restricción se añadió con ALTER TABLE.",
    sql_issue_sqlite_alter_fk:
      "SQLite no puede añadir claves foráneas con ALTER TABLE; se escribieron dentro de CREATE TABLE.",
    sql_issue_pg_extension:
      "{{type}} necesita la extensión de PostgreSQL {{extension}}.",
    sql_issue_oracle_interval:
      "{{table}}.{{column}}: Oracle necesita un INTERVAL cualificado; se usó INTERVAL DAY TO SECOND.",
    sql_issue_comment_truncated:
      "El comentario de {{object}} se recortó a {{max}} caracteres, el máximo que guarda {{dialect}}.",
    table_w_no_name: "Declarada una tabla sin nombre",
    duplicate_table_by_name: "Tabla duplicada con el nombre '{{tableName}}'",
    empty_field_name: "Campo `name` vacío en la tabla '{{tableName}}'",
    empty_field_type: "Campo `type` vacío en la tabla '{{tableName}}'",
    no_values_for_field:
      "El campo '{{fieldName}}' de la tabla '{{tableName}}' es de tipo `{{type}}` pero no se han especificado valores",
    default_doesnt_match_type:
      "El valor predeterminado para el campo '{{fieldName}}' en la tabla '{{tableName}}' no coincide con su tipo",
    not_null_is_null:
      "El campo '{{fieldName}}' de la tabla '{{tableName}}' es NOT NULL pero tiene NULL por defecto",
    duplicate_fields:
      "Campos de tabla duplicados por nombre '{{fieldName}}' en la tabla '{{tableName}}'",
    duplicate_index:
      "Índice duplicado por nombre '{{indexName}}' en la tabla '{{tableName}}'",
    empty_index: "Índice en la tabla '{{tableName}}' no indexa columnas",
    no_primary_key: "La tabla '{{tableName}}' no tiene clave primaria",
    type_with_no_name: "Declarado un tipo sin nombre",
    duplicate_types: "Tipos duplicados con el nombre '{{typeName}}'",
    type_w_no_fields: "Declarado un tipo vacío '{{typeName}}' sin campos",
    empty_type_field_name: "Campo `name` vacío en el tipo '{{typeName}}'",
    empty_type_field_type: "Campo `type` vacío en el tipo '{{typeName}}'",
    no_values_for_type_field:
      "El campo '{{fieldName}}' del tipo '{{typeName}}' es de tipo `{{type}}` pero no se han especificado valores",
    duplicate_type_fields:
      "Campos de tipo duplicados por nombre '{{fieldName}}' en el tipo '{{typeName}}'",
    duplicate_reference: "Referencia duplicada con el nombre '{{refName}}'",
    circular_dependency:
      "Dependencia circular involucrando la tabla '{{refName}}'",
    timeline: "Línea del tiempo",
    priority: "Prioridad",
    none: "Ninguno",
    low: "Bajo",
    medium: "Medio",
    high: "Alto",
    sort_by: "Ordenar por",
    my_order: "Mi orden",
    completed: "Completado",
    alphabetically: "Alfabéticamente",
    add_task: "Agregar tarea",
    details: "Detalles",
    no_tasks: "Aún no tienes tareas.",
    no_activity: "Aún no tienes actividad.",
    move_element: "Mover {{name}} a {{coords}}",
    edit_area: "{{extra}} Editar área {{areaName}}",
    delete_area: "Eliminar área {{areaName}}",
    edit_note: "{{extra}} Editar nota {{noteTitle}}",
    delete_note: "Eliminar nota {{noteTitle}}",
    edit_table: "{{extra}} Editar tabla {{tableName}}",
    delete_table: "Eliminar tabla {{tableName}}",
    edit_type: "{{extra}} Editar tipo {{typeName}}",
    delete_type: "Eliminar tipo {{typeName}}",
    add_relationship: "Agregar relación",
    edit_relationship: "{{extra}} Editar relación {{refName}}",
    delete_relationship: "Eliminar relación {{refName}}",
    not_found: "No encontrado",
    pick_db: "Elegir base de datos",
    generic: "Genérico",
    generic_description:
      "Los diagramas genéricos se pueden exportar a cualquier formato SQL, pero soportan un número limitado de tipos de datos.",
    enums: "Enumeraciones",
    add_enum: "Añadir enumeración",
    edit_enum: "{{extra}} Editar enumeración {{enumName}}",
    delete_enum: "Borrar enumeración",
    enum_w_no_name: "Encontrada una enumeración sin nombre",
    enum_w_no_values: "Se encontró '{{enumName}}' sin ningún valor",
    duplicate_enums: "Enumeraciones duplicadas con el nombre '{{enumName}}'",
    no_enums: "Sin enumeraciones",
    no_enums_text: "Definir aquí las enumeraciones",
    declare_array: "Declarar array",
    empty_index_name:
      "Declarado un índice sin nombre en la tabla '{{tableName}}'",
    didnt_find_diagram: "¡Ups! Diagrama no encontrado.",
    unsigned: "Sin signo",
    share: "Compartir",
    unshare: "Descompartir",
    copy_link: "Copiar enlace",
    readme: "README",
    failed_to_load: "Error al cargar. Asegúrate de que el enlace sea correcto.",
    share_info:
      "* Compartir este enlace no creará una sesión de colaboración en tiempo real.",
    show_relationship_labels: "Mostrar etiquetas de relación",
    docs: "Documentación",
    supported_types: "Tipos de archivo compatibles:",
    bulk_update: "Actualización en bloque",
    multiselect: "Multiselector",
    export_saved_data: "Exportar los datos guardados",
    dbml_view: "Vista DBML",
    tab_view: "Vista de pestañas",
    label: "Etiqueta",
    many_side_label: "Etiqueta del lado muchos (n)",
    version: "Versión",
    versions: "Versiones",
    no_saved_versions: "No hay versiones guardadas",
    record_version: "Guardar versión",
    committed_at: "Confirmado en",
    read_only: "Solo lectura",
    continue: "Continuar",
    restore_version: "Restaurar versión",
    restore_warning: "Cargar otra versión sobrescribirá cualquier cambio.",
    return_to_current: "Volver al diagrama",
    no_changes_to_record: "No hay cambios que guardar",
    click_to_view: "Haz clic para ver",
    load_more: "Cargar más",
    clear_cache: "Limpiar caché",
    cache_cleared: "Caché limpiada",
    failed_to_record_version: "Error al guardar versión",
    failed_to_load_diagram: "Error al cargar el diagrama",
    see_all: "Ver todo",
    configure_custom_types: "Configurar tipos personalizados",
    saved_as_copy: "Guardado como copia. Abrir:",
    toolbar: "Barra de herramientas",
    add: "Añadir",
    add_comment: "Añadir comentario",
    composite_key: "Clave compuesta",
    composite_key_hint: "Añade campos para formar una clave compuesta.",
    unique_constraints: "Restricciones únicas",
    add_unique_constraint: "Añadir restricción única",
    references: "Referencias",
    enum_deleted: "Enum eliminado",
    migrations: "Migraciones",
    generate_migration: "Generar migración",
    migration_not_supported_generic:
      "Las migraciones no están disponibles para diagramas genéricos.",
    no_migration_needed: "No hace falta migración",
    scripts: "Scripts",
    json_diff: "Diferencias JSON",
    download: "Descargar",
    insert_sql: "Insertar SQL",
    upload_file: "Subir archivo",
    type_color: "Color",
    custom_types_description:
      "Define tipos de datos personalizados que no están disponibles por defecto. Se comparten con todas las personas de este servidor y se pueden usar al crear o editar columnas.",
    type_data_corrupted: "Los tipos configurados están dañados.",
    no_custom_types: "No tienes ningún tipo configurado",
    close: "Cerrar",
    add_custom_type: "Añadir tipo personalizado",
    type_name_required: "El nombre del tipo es obligatorio",
    database: "Base de datos",
    saved: "Guardado",
    structure: "Estructura",
    code: "Código",
    embed_settings: "Opciones de inserción",
    default: "Por defecto",
    hide: "Ocultar",
    force_hide: "Ocultar siempre",
    primary_key: "Clave primaria",
    foreign_key: "Clave foránea",
    collaboration_connected: "Conectado",
    collaboration_connecting: "Conectando",
    collaboration_disconnected: "Desconectado",
    collaboration_participants: "{{count}} participantes",
    collaboration_participants_one: "{{count}} participante",
    collaboration_participants_other: "{{count}} participantes",
    collaboration_participant: "Otro participante",
    collaboration_table_lock_denied: "{{name}} está editando esta tabla",
    collaboration_table_lock_unavailable:
      "No se pudo bloquear esta tabla para editarla",
    collaboration_table_lock_pending: "Solicitando permiso de edición...",
    all_databases: "Todas las bases de datos",
    all_types: "Todos los tipos",
    cloud: "Servidor",
    local: "Local",
    owner: "Propietario",
    you: "Tú",
    diagrams: "Diagramas",
    templates: "Plantillas",
    no_diagrams_match: "Ningún diagrama coincide con los filtros.",
    failed_to_load_diagrams: "No se pudieron cargar los diagramas",
    sign_in: "Iniciar sesión",
    sign_out: "Cerrar sesión",
    signed_in_as: "Sesión iniciada como",
    username: "Usuario",
    password: "Contraseña",
    confirm_password: "Confirmar contraseña",
    sign_in_subtitle: "Inicia sesión para abrir y compartir tus diagramas.",
    create_admin_account: "Crear la cuenta de administrador",
    create_admin_subtitle:
      "Esta instancia aún no tiene cuentas. La primera que crees la administra y da de alta al resto.",
    setup_code: "Código de instalación",
    setup_code_hint:
      "Aparece en el registro (log) del servidor al arrancar sin cuentas, o es el SETUP_CODE que configuraste.",
    set_up_instance: "Configurar esta instancia",
    registration_closed:
      "Las cuentas las crea el administrador de esta instancia.",
    have_account: "¿Ya tienes cuenta?",
    administration: "Administración",
    add_user: "Añadir usuario",
    users: "Usuarios",
    admin_users_subtitle:
      "Todas las cuentas de esta instancia, incluidas las que crean los propios usuarios. Las cuentas nuevas son usuarios normales.",
    create_account: "Crear una cuenta",
    create_account_subtitle:
      "Elige un usuario y una contraseña para empezar a usar esta instancia.",
    no_account: "¿Aún no tienes cuenta?",
    change_password: "Cambiar contraseña",
    current_password: "Contraseña actual",
    new_password: "Contraseña nueva",
    reset_password: "Restablecer contraseña",
    password_reset_done:
      "Contraseña de {{username}} restablecida. Se han cerrado sus sesiones.",
    password_changed: "Contraseña cambiada. Se han cerrado las demás sesiones.",
    user_created: "Cuenta {{username}} creada",
    admin_label: "Administrador",
    failed_to_load_users: "No se pudieron cargar los usuarios",
    username_rules:
      "De 3 a 32 caracteres: letras, cifras, punto, guion o guion bajo.",
    password_rules: "Al menos 8 caracteres.",
    passwords_do_not_match: "Las contraseñas no coinciden",
    sign_in_failed: "No se pudo iniciar sesión",
    sign_up_failed: "No se pudo crear la cuenta",
    git_sync: "Sincronizar con git",
    git_repository: "Repositorio",
    git_remote_url: "URL del repositorio",
    git_remote_url_hint:
      "Una URL https:// o git@host:ruta. El servidor sube y descarga con ella.",
    git_branch: "Rama",
    git_directory: "Ruta en el repositorio",
    git_directory_hint: "Déjalo vacío para guardar en la raíz del repositorio.",
    git_file_name: "Nombre de archivo",
    git_file_name_hint: "Se guarda como <nombre>.json y <nombre>.sql.",
    git_auth_username: "Usuario",
    git_auth_username_hint: "Para remotos https. Por defecto, x-access-token.",
    git_token: "Token de acceso",
    git_token_hint:
      "Un token de acceso personal con permiso de escritura. Se guarda cifrado y nunca se devuelve.",
    git_token_stored: "Se conserva el token guardado salvo que lo sustituyas",
    git_token_help: "Cómo crear un token de acceso",
    git_token_help_github:
      "GitHub: token de acceso personal de grano fino (fine-grained)",
    git_token_help_github_owner:
      "Resource owner: la cuenta u organización dueña del repositorio. La organización debe permitir los tokens de grano fino para que lo vean.",
    git_token_help_github_repository:
      "Repository access: Only select repositories, y elige el repositorio del esquema.",
    git_token_help_github_contents:
      "Repository permissions → Contents: Read and write. Es el único permiso necesario; cubre descargar, subir y crear la rama en la primera subida.",
    git_token_help_github_metadata:
      "Metadata: Read-only lo añade GitHub y no se puede quitar. No hace falta nada más; Workflows solo importa para commits que tocan .github/workflows.",
    git_token_help_github_expiry:
      "Cuando el token caduca, la subida falla con un error de autenticación. Pega aquí un token nuevo para sustituirlo.",
    git_token_help_gitlab:
      "GitLab: un token de acceso de proyecto con el rol Developer y el ámbito write_repository.",
    git_token_help_sso:
      "Una organización que usa SAML SSO también tiene que autorizar el token.",
    git_token_help_protected:
      "Una rama que solo admite pull requests rechaza la subida. Sincroniza con una rama no protegida.",
    git_author_name: "Autor del commit",
    git_author_email: "Correo del autor",
    git_save_settings: "Guardar ajustes",
    git_test_connection: "Probar conexión",
    git_disconnect: "Desconectar",
    git_disconnect_confirm:
      "El diagrama deja de sincronizarse. No se borra nada de lo ya subido.",
    git_not_connected_hint:
      "Este diagrama aún no está conectado a un repositorio. Rellena los datos del repositorio para empezar a sincronizar.",
    git_files: "Guarda {{json}} y {{sql}}",
    git_last_sync: "Última sincronización {{when}} ({{commit}})",
    git_commit_message: "Mensaje del commit",
    git_commit_message_placeholder: "Mensaje del commit (opcional)",
    git_push: "Commit y push",
    git_pull: "Traer del repositorio",
    git_pull_confirm:
      "El diagrama se sustituye por la versión del repositorio para todos los que lo están editando. Se pierden los cambios locales sin guardar.",
    git_history: "Historial",
    git_pushed: "Subido como {{commit}}",
    git_unchanged: "El repositorio ya está al día",
    git_pulled: "Traído {{commit}} del repositorio",
    git_connection_ok: "El repositorio y la rama son accesibles",
    git_branch_missing:
      "El repositorio es accesible. La rama {{branch}} se crea en la primera subida.",
    git_unavailable:
      "La sincronización con repositorios no está disponible en este servidor (git no está instalado o está desactivada).",
    git_owner_only:
      "Solo el propietario del diagrama puede cambiar estos ajustes. Aun así puedes subir y traer cambios.",
    access_revoked: "Ya no tienes acceso a este diagrama.",
    access_now_viewer: "Ahora solo puedes ver este diagrama.",
    access_now_editor: "Ya puedes editar este diagrama.",
    delete_field: "Eliminar campo",
    deleted_objects_one: "{{count}} objeto eliminado",
    deleted_objects_other: "{{count}} objetos eliminados",
    delete_table_item: "Eliminar tabla",
    reset_route: "Restablecer trazado de la línea",
    drag_to_move_line: "Arrastra para mover la línea",
    delete_table_confirm: "¿Eliminar la tabla {{name}}?",
    delete_field_confirm: "¿Eliminar el campo {{name}}?",
    delete_selection_confirm: "¿Eliminar los {{count}} objetos seleccionados?",
    delete_dependencies_one:
      "Tiene {{count}} relación, que también se eliminará:",
    delete_dependencies_other:
      "Tiene {{count}} relaciones, que también se eliminarán:",
    no_access: "Sin acceso",
    custom_types_save_failed:
      "No se pudieron guardar los tipos personalizados.",
    your_role: "Tu rol",
    role_owner: "Propietario",
    role_editor: "Editor",
    role_viewer: "Lector",
    role_none: "Sin acceso",
    link_access: "Todas las cuentas de este servidor",
    link_access_none: "Sin acceso",
    link_access_viewer: "Pueden verlo",
    link_access_editor: "Pueden editarlo",
    link_access_none_desc:
      "Solo el propietario y las personas de abajo pueden abrirlo.",
    link_access_viewer_desc:
      "Cualquiera con cuenta puede abrirlo en solo lectura; las personas de abajo mantienen su rol.",
    link_access_editor_desc: "Cualquiera con cuenta puede abrirlo y editarlo.",
    sharing_saved: "Permisos actualizados",
    people_with_access: "Personas con acceso",
    not_shared_yet: "Aún no se ha compartido con nadie.",
    left_diagram: "Has salido del diagrama",
    leave: "Salir",
    remove: "Quitar",
    share_with: "Compartir con",
    pick_user: "Elige una persona",
    no_more_users: "Todos tienen ya acceso",
    transfer_ownership: "Transferir la propiedad",
    transfer_ownership_confirm:
      "El nuevo propietario decide quién puede abrirlo. Tú sigues como editor.",
    transfer_ownership_desc:
      "Pasa el diagrama a otra persona; tú puedes seguir editándolo.",
    ownership_transferred: "Propiedad transferida",
    transfer: "Transferir",
    version_history: "Historial de versiones",
    export_migration: "Exportar migración SQL (ALTER)…",
    migration_current: "{{name}} tal como está ahora",
    version_name_placeholder:
      'Nombra la versión actual, p. ej. "1.0 publicada"',
    name_version: "Guardar versión",
    version_named: "Versión guardada",
    version_restored: "Versión {{version}} restaurada",
    history_empty: "Aún no hay versiones guardadas.",
    history_pick: "Elige una versión para ver qué ha cambiado desde entonces.",
    history_autosave: "Guardada al editar",
    history_label_created: "Creación",
    history_label_named: "Versión con nombre",
    history_label_restored: "Tras una restauración",
    history_label_before_change: "Antes de restaurar o traer",
    history_label_git_pull: "Traída del repositorio",
    history_tag_created: "creación",
    history_tag_named: "con nombre",
    history_tag_restored: "restaurada",
    history_tag_before_change: "respaldo",
    history_tag_git_pull: "pull",
    history_edited_by: "editada por {{names}}",
    history_changes_since: "Cambios de esta versión a {{name}}",
    history_same: "El mismo esquema que ahora.",
    history_tables_added: "Tablas añadidas",
    history_tables_removed: "Tablas eliminadas",
    history_table_changed: "Tabla modificada",
    history_indexes: "índices o claves únicas",
    history_relationships_added: "Relaciones añadidas",
    history_relationships_removed: "Relaciones eliminadas",
    history_relationships_changed: "Relaciones modificadas",
    history_restore_confirm:
      "El diagrama vuelve a la versión {{version}} para todos los que lo editan. El estado actual se guarda como versión, así que se puede deshacer.",
    history_migration: "Migración SQL hasta ahora",
    history_migration_desc:
      "Sentencias ALTER que llevan una base de datos creada con esta versión al diagrama actual.",
    activity: "Actividad",
    activity_empty: "Aún no hay nada registrado.",
    activity_system: "Sistema",
    never: "nunca",
    created: "Creada",
    last_login: "Último acceso",
    disabled: "Desactivada",
    enable_user: "Activar",
    disable_user: "Desactivar",
    enable_user_confirm: "{{username}} podrá volver a iniciar sesión.",
    disable_user_confirm:
      "{{username}} sale de su sesión y no podrá entrar hasta que se active de nuevo. Sus diagramas se conservan.",
    user_disabled_done: "{{username}} desactivada",
    user_enabled_done: "{{username}} activada",
    user_deleted_done_one: "{{username}} eliminada; 1 diagrama transferido",
    user_deleted_done_other:
      "{{username}} eliminada; {{count}} diagramas transferidos",
    delete_user: "Eliminar cuenta",
    delete_user_explain:
      "{{username}} se elimina para siempre. Sus diagramas pasan a la persona que elijas y se quitan sus permisos compartidos.",
    transfer_diagrams_to: "Pasar los diagramas a",
    all_users: "Todas las personas",
    all_actions: "Todas las acciones",
    backups: "Copias de seguridad",
    backups_explain:
      "Copias de la base de datos hechas mientras el servidor funciona.",
    back_up_now: "Hacer copia ahora",
    backup_done: "Copia {{name}} creada",
    no_backups: "Aún no hay copias.",
    backups_off:
      "Las copias están desactivadas: define BACKUP_DIR en el servidor para activarlas.",
    sql_opt_destructive: "Borrar tablas y columnas",
    sql_opt_destructive_desc:
      "Desactivado: DROP TABLE y DROP COLUMN se escriben como comentarios y no se borra ningún dato.",
    cpp_opt_namespaceName: "Namespace",
    cpp_opt_namespaceName_desc:
      "Namespace C++ de los structs; anidados con ::. Vacío: a partir del título del diagrama.",
    cpp_opt_standard: "Estándar C++",
    cpp_opt_standard_desc:
      "C++20 añade == por defecto y std::chrono::sys_days para las fechas.",
    cpp_opt_standard_cpp17: "C++17",
    cpp_opt_standard_cpp20: "C++20",
    cpp_opt_nullableAs: "Columnas que admiten NULL",
    cpp_opt_nullableAs_desc:
      "std::optional distingue NULL de un valor; un tipo simple no.",
    cpp_opt_nullableAs_optional: "std::optional<T>",
    cpp_opt_nullableAs_plain: "T simple",
    cpp_opt_sqlpp11: "Tablas sqlpp11",
    cpp_opt_sqlpp11_desc:
      "Definiciones de tabla para consultas con tipos de sqlpp11 (como las escribe su herramienta ddl2cpp).",
    cpp_opt_soci: "Conversiones SOCI",
    cpp_opt_soci_desc:
      "soci::type_conversion para cada struct, para que into() y use() trabajen con filas completas.",
    cpp_opt_includeComments: "Comentarios",
    cpp_opt_includeComments_desc:
      "Comentarios de tablas y columnas, claves y referencias como comentarios ///.",
    cpp_opt_typeCase: "Nombres de tipo",
    cpp_opt_typeCase_desc:
      "Cómo se convierten los nombres de tabla en nombres de struct.",
    cpp_opt_typeCase_pascal: "PascalCase",
    cpp_opt_typeCase_original: "Como en el diagrama",
    cpp_opt_memberCase: "Nombres de miembros",
    cpp_opt_memberCase_desc:
      "Cómo se convierten las columnas en miembros. Los nombres de columna en SQL no cambian.",
    cpp_opt_memberCase_original: "Como en el diagrama",
    cpp_opt_memberCase_snake: "snake_case",
    cpp_opt_memberCase_camel: "camelCase",
    cpp_opt_singularTypes: "Nombres de tipo en singular",
    cpp_opt_singularTypes_desc:
      "customers → Customer, order_items → OrderItem.",
    cpp_opt_typeSuffix: "Sufijo de tipo",
    cpp_opt_typeSuffix_desc:
      "Se añade a cada nombre de struct, p. ej. CustomerRow.",
    cpp_opt_timeAs: "Fechas y horas",
    cpp_opt_timeAs_desc:
      "Puntos en el tiempo y duraciones de std::chrono (UTC), std::tm, o texto tal como lo escribe la base de datos.",
    cpp_opt_timeAs_chrono: "std::chrono",
    cpp_opt_timeAs_tm: "std::tm",
    cpp_opt_timeAs_string: "std::string",
    cpp_opt_decimalAs: "DECIMAL / NUMERIC",
    cpp_opt_decimalAs_desc:
      "double es cómodo pero inexacto a partir de 15 dígitos; std::string conserva el valor exacto.",
    cpp_opt_decimalAs_double: "double",
    cpp_opt_decimalAs_string: "std::string",
    cpp_opt_enumClasses: "Enum class",
    cpp_opt_enumClasses_desc:
      "Columnas ENUM y tipos enum como enum class con to_string/from_string; desactivado: std::string.",
    cpp_opt_columnNames: "Nombres de tabla y columna",
    cpp_opt_columnNames_desc:
      "Constantes kTable, Column::nombre, kColumns y kPrimaryKey para escribir SQL.",
    cpp_opt_defaults: "Valores por defecto",
    cpp_opt_defaults_desc:
      "Inicializa los miembros con el DEFAULT literal de la columna (números, texto, booleanos, valores enum).",
    cpp_opt_comparisons: "== y !=",
    cpp_opt_comparisons_desc: "Operadores de comparación miembro a miembro.",
    cpp_opt_headerGuard: "Protección de cabecera",
    cpp_opt_headerGuard_desc:
      "#pragma once o una protección clásica con #ifndef.",
    cpp_opt_headerGuard_pragma_once: "#pragma once",
    cpp_opt_headerGuard_ifndef: "#ifndef / #define",
    sql_issue_migration_no_changes:
      "Las dos versiones definen el mismo esquema.",
    sql_issue_migration_drop_table: "{{table}} se elimina con todas sus filas.",
    sql_issue_migration_drop_column:
      "{{table}}.{{column}} se elimina con los datos que contiene.",
    sql_issue_migration_not_null_no_default:
      "{{table}}.{{column}} se añade como NOT NULL sin valor por defecto: falla si la tabla tiene filas. Dale un valor por defecto, o añádela admitiendo NULL, rellénala y después hazla NOT NULL.",
    sql_issue_migration_set_not_null:
      "{{table}}.{{column}} pasa a NOT NULL: falla si alguna fila tiene NULL en ella.",
    sql_issue_migration_type_change:
      "{{table}}.{{column}} cambia de {{from}} a {{to}}: los valores que no se puedan convertir hacen que falle.",
    sql_issue_migration_oracle_type_change:
      "{{table}}.{{column}}: Oracle solo reduce o cambia el tipo de una columna vacía.",
    sql_issue_migration_identity_manual:
      "{{table}}.{{column}}: {{dialect}} no puede añadir ni quitar una identidad en una columna existente; hay que recrear la tabla a mano.",
    sql_issue_migration_enum_values_removed:
      "{{name}} pierde {{values}}: las filas que los usan hacen que la migración falle.",
    sql_issue_migration_sqlite_rebuild:
      "SQLite no puede cambiar {{table}} directamente: se reconstruye (tabla nueva, se copian las filas y se elimina la antigua).",
    sql_issue_migration_sqlite_rebuild_skipped:
      "Reconstruir {{table}} elimina columnas, así que se escribe como comentarios mientras el borrado esté desactivado.",
    sql_issue_migration_inherits_manual:
      "Las tablas de las que hereda {{table}} han cambiado; cambia INHERITS a mano.",
    cpp_issue_name_changed:
      '"{{name}}" no es un nombre C++ válido o libre; se exportó como {{newName}}.',
    cpp_issue_namespace_invalid:
      'El namespace "{{name}}" no es un nombre C++ válido; se usó {{newName}}.',
    cpp_issue_type_as_text:
      "{{table}}.{{column}} ({{type}}) no tiene equivalente en C++ y es un std::string.",
    cpp_issue_decimal_as_double:
      "{{table}}.{{column}} ({{type}}) es un double: los valores con más de 15 cifras significativas pierden precisión. Usa std::string para decimales en los ajustes avanzados para mantenerlos exactos.",
    cpp_issue_integer_may_overflow:
      "{{table}}.{{column}} ({{type}}) puede guardar más de 64 bits; es un std::int64_t.",
    cpp_issue_set_as_text:
      "{{table}}.{{column}} es un SET: sus valores se guardan en un único std::string separado por comas.",
    cpp_issue_soci_skipped:
      "{{table}}.{{column}} ({{type}}) no puede pasar por soci::values y queda fuera de su conversión SOCI.",
    cpp_issue_soci_time_precision:
      "SOCI transporta fechas y horas como std::tm: se pierden las fracciones de segundo.",
    cpp_issue_sqlpp_as_text:
      "{{table}}.{{column}} ({{type}}) no tiene tipo sqlpp11 y se declara como texto.",
    cpp_issue_tm_not_comparable:
      "std::tm no tiene ==, así que no se generaron operadores de comparación para {{table}}.",
    cpp_issue_enum_value_renamed:
      'El valor "{{value}}" de {{name}} es el enumerador {{newName}}.',
    audit_auth_setup: "creó la cuenta de administrador",
    audit_auth_signup: "se registró",
    audit_auth_login: "inició sesión",
    audit_auth_login_failed: "no pudo iniciar sesión como",
    audit_auth_login_disabled: "intentó entrar en una cuenta desactivada",
    audit_auth_logout: "cerró sesión",
    audit_auth_password_changed: "cambió su contraseña",
    audit_user_created: "creó la cuenta",
    audit_user_password_reset: "restableció la contraseña de",
    audit_user_disabled: "desactivó la cuenta",
    audit_user_enabled: "activó la cuenta",
    audit_user_deleted: "eliminó la cuenta",
    audit_diagram_created: "creó el diagrama",
    audit_diagram_edited: "editó el diagrama",
    audit_diagram_renamed: "renombró el diagrama a",
    audit_diagram_deleted: "eliminó el diagrama",
    audit_diagram_restored: "restauró una versión del diagrama",
    audit_diagram_version_named: "nombró una versión",
    audit_diagram_member_set: "compartió el diagrama con",
    audit_diagram_member_removed: "dejó de compartir el diagrama con",
    audit_diagram_link_access: "cambió quién puede abrir el diagrama",
    audit_diagram_owner_changed: "pasó el diagrama a",
    audit_git_configured: "conectó el diagrama a un repositorio",
    audit_git_disconnected: "desconectó el repositorio",
    audit_git_pushed: "subió al repositorio",
    audit_git_pulled: "trajo del repositorio",
    audit_types_changed: "cambió los tipos personalizados",
    audit_backup_created: "hizo una copia de seguridad",
    audit_backup_downloaded: "descargó la copia de seguridad",
  },
};

export { es, spanish };
