import { useMemo, useRef, useState, useEffect } from "react";
import {
  Action,
  Cardinality,
  ObjectType,
  Tab,
  gridSize,
} from "../../data/constants";
import {
  bendOrigin,
  calcPath,
  calcCompositePath,
  clampBend,
  defaultBend,
  fieldAnchorY,
  relationshipBendX,
} from "../../utils/calcPath";
import {
  useDiagram,
  useSettings,
  useLayout,
  useSelect,
  useUndoRedo,
} from "../../hooks";
import { useTranslation } from "react-i18next";
import { SideSheet } from "@douyinfe/semi-ui";
import RelationshipInfo from "../EditorSidePanel/RelationshipsTab/RelationshipInfo";
import {
  getVisibleFieldIndex,
  getVisibleFields,
  getRelationshipFields,
} from "../../utils/utils";

const labelFontSize = 16;

export default function Relationship({ data }) {
  const { settings } = useSettings();
  const { tables, relationships, updateRelationship } = useDiagram();
  const { layout } = useLayout();
  const { selectedElement, setSelectedElement, setBulkSelectedElements } =
    useSelect();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { t } = useTranslation();
  // While the line is being dragged: where its vertical segment is.
  const [dragBendX, setDragBendX] = useState(null);
  const dragRef = useRef(null);

  const pathValues = useMemo(() => {
    const startTable = tables.find((t) => t.id === data.startTableId);
    const endTable = tables.find((t) => t.id === data.endTableId);

    if (!startTable || !endTable || startTable.hidden || endTable.hidden)
      return null;

    const startFields = getVisibleFields(startTable, relationships);
    const endFields = getVisibleFields(endTable, relationships);

    const pairs = getRelationshipFields(data);

    return {
      startFieldIndex: getVisibleFieldIndex(
        startTable,
        data.startFieldId,
        relationships,
      ),
      endFieldIndex: getVisibleFieldIndex(
        endTable,
        data.endFieldId,
        relationships,
      ),
      startFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(startTable, p.startFieldId, relationships),
      ),
      endFieldIndices: pairs.map((p) =>
        getVisibleFieldIndex(endTable, p.endFieldId, relationships),
      ),
      startTable: {
        x: startTable.x,
        y: startTable.y,
        comment: startTable.comment,
        fields: startFields,
      },
      endTable: {
        x: endTable.x,
        y: endTable.y,
        comment: endTable.comment,
        fields: endFields,
      },
    };
  }, [tables, relationships, data]);

  const isComposite = (pathValues?.startFieldIndices?.length ?? 0) > 1;

  // While dragging, the segment also stays clear of the tables.
  const bendX = !pathValues
    ? null
    : dragBendX !== null
      ? clampBend(
          dragBendX,
          pathValues.startTable,
          pathValues.endTable,
          settings.tableWidth,
        )
      : relationshipBendX(
          data,
          pathValues.startTable,
          pathValues.endTable,
          settings.tableWidth,
        );

  const composite = useMemo(() => {
    if (!pathValues || !isComposite) return null;
    return calcCompositePath(
      {
        startTable: pathValues.startTable,
        endTable: pathValues.endTable,
        startFieldIndices: pathValues.startFieldIndices,
        endFieldIndices: pathValues.endFieldIndices,
      },
      settings.tableWidth,
      1,
      settings.showComments,
      bendX,
    );
  }, [
    pathValues,
    isComposite,
    settings.tableWidth,
    settings.showComments,
    bendX,
  ]);

  const path = pathValues
    ? composite
      ? composite.path
      : calcPath(
          pathValues,
          settings.tableWidth,
          1,
          settings.showComments,
          bendX,
        )
    : "";

  const isSelected =
    selectedElement.element === ObjectType.RELATIONSHIP &&
    selectedElement.id === data.id;

  const pathRef = useRef();
  const labelRef = useRef();

  let cardinalityStart = "1";
  let cardinalityEnd = "1";

  switch (data.cardinality) {
    // the translated values are to ensure backwards compatibility
    case t(Cardinality.MANY_TO_ONE):
    case Cardinality.MANY_TO_ONE:
      cardinalityStart = data.manyLabel || "n";
      cardinalityEnd = "1";
      break;
    case t(Cardinality.ONE_TO_MANY):
    case Cardinality.ONE_TO_MANY:
      cardinalityStart = "1";
      cardinalityEnd = data.manyLabel || "n";
      break;
    case t(Cardinality.ONE_TO_ONE):
    case Cardinality.ONE_TO_ONE:
      cardinalityStart = "1";
      cardinalityEnd = "1";
      break;
    default:
      break;
  }

  let cardinalityStartX = 0;
  let cardinalityEndX = 0;
  let cardinalityStartY = 0;
  let cardinalityEndY = 0;
  let labelX = 0;
  let labelY = 0;

  let labelWidth = labelRef.current?.getBBox().width ?? 0;
  let labelHeight = labelRef.current?.getBBox().height ?? 0;

  const cardinalityOffset = 28;

  if (composite) {
    labelX = composite.labelPoint.x - (labelWidth ?? 0) / 2;
    labelY = composite.labelPoint.y + (labelHeight ?? 0) / 2;
    cardinalityStartX = composite.startCardinality.x;
    cardinalityStartY = composite.startCardinality.y;
    cardinalityEndX = composite.endCardinality.x;
    cardinalityEndY = composite.endCardinality.y;
  } else if (pathRef.current) {
    const pathLength = pathRef.current.getTotalLength();

    const labelPoint = pathRef.current.getPointAtLength(pathLength / 2);
    labelX = labelPoint.x - (labelWidth ?? 0) / 2;
    labelY = labelPoint.y + (labelHeight ?? 0) / 2;

    const point1 = pathRef.current.getPointAtLength(cardinalityOffset);
    cardinalityStartX = point1.x;
    cardinalityStartY = point1.y;
    const point2 = pathRef.current.getPointAtLength(
      pathLength - cardinalityOffset,
    );
    cardinalityEndX = point2.x;
    cardinalityEndY = point2.y;
  }

  // The grip that moves the line: on its vertical segment.
  let handle = null;
  if (composite) {
    handle = composite.labelPoint;
  } else if (pathValues && Number.isFinite(bendX)) {
    const anchor = (table, index) =>
      fieldAnchorY(table, index, settings.tableWidth, settings.showComments);
    handle = {
      x: bendX,
      y:
        (anchor(pathValues.startTable, pathValues.startFieldIndex) +
          anchor(pathValues.endTable, pathValues.endFieldIndex)) /
        2,
    };
  } else if (pathValues) {
    // Where the automatic route has its vertical segment, so the first
    // movement continues from there.
    handle = defaultBend(
      pathValues,
      settings.tableWidth,
      1,
      settings.showComments,
    );
  }

  const select = () => {
    setSelectedElement((prev) => ({
      ...prev,
      element: ObjectType.RELATIONSHIP,
      id: data.id,
      open: false,
    }));
    setBulkSelectedElements([]);
  };

  // Pointer position in diagram coordinates.
  const diagramX = (e) => {
    const svg = e.currentTarget.ownerSVGElement;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse()).x;
  };

  const startDrag = (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.stopPropagation();
    select();
    if (layout.readOnly || !handle) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      grab: diagramX(e) - handle.x,
      startX: e.clientX,
      moved: false,
      x: null,
    };
  };

  const drag = (e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    // A click that wobbles a pixel or two is not a move.
    if (!dragRef.current.moved) {
      if (Math.abs(e.clientX - dragRef.current.startX) < 4) return;
      dragRef.current.moved = true;
    }
    let x = diagramX(e) - dragRef.current.grab;
    if (settings.snapToGrid) x = Math.round(x / gridSize) * gridSize;
    dragRef.current.x = x;
    setDragBendX(x);
  };

  const endDrag = (e) => {
    const state = dragRef.current;
    dragRef.current = null;
    setDragBendX(null);
    if (!state) return;
    e.stopPropagation();
    if (!state.moved || state.x === null || !pathValues) return;
    const x = clampBend(
      state.x,
      pathValues.startTable,
      pathValues.endTable,
      settings.tableWidth,
    );
    if (x === null) return;
    const offset =
      Math.round(
        (x -
          bendOrigin(
            pathValues.startTable,
            pathValues.endTable,
            settings.tableWidth,
          )) *
          10,
      ) / 10;
    if (offset === data.bendOffset) return;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.RELATIONSHIP,
        rid: data.id,
        undo: { bendOffset: data.bendOffset ?? null },
        redo: { bendOffset: offset },
        message: t("edit_relationship", {
          refName: data.name,
          extra: "[route]",
        }),
      },
    ]);
    setRedoStack([]);
    updateRelationship(data.id, { bendOffset: offset });
  };

  const edit = () => {
    if (!layout.sidebar) {
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
    } else {
      setSelectedElement((prev) => ({
        ...prev,
        currentTab: Tab.RELATIONSHIPS,
        element: ObjectType.RELATIONSHIP,
        id: data.id,
        open: true,
      }));
      if (selectedElement.currentTab !== Tab.RELATIONSHIPS) return;
      document
        .getElementById(`scroll_ref_${data.id}`)
        .scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!pathValues) return null;

  return (
    <>
      <g
        className="select-none group"
        onDoubleClick={edit}
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          e.stopPropagation();
          select();
        }}
        data-ctx-type={ObjectType.RELATIONSHIP}
        data-ctx-id={data.id}
        data-testid={`relationship-${data.name}`}
      >
        {/* invisible wider path for better hover ux */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          cursor="pointer"
        />
        <path
          ref={pathRef}
          d={path}
          className={`relationship-path${isSelected ? " relationship-selected" : ""}`}
          fill="none"
          cursor="pointer"
        />
        {settings.showRelationshipLabels && (
          <text
            x={labelX}
            y={labelY}
            fill={settings.mode === "dark" ? "lightgrey" : "#333"}
            fontSize={labelFontSize}
            fontWeight={500}
            ref={labelRef}
            className="group-hover:fill-sky-600"
          >
            {data.name}
          </text>
        )}
        {(composite || pathRef.current) && settings.showCardinality && (
          <>
            <CardinalityLabel
              x={cardinalityStartX}
              y={cardinalityStartY}
              text={cardinalityStart}
            />
            <CardinalityLabel
              x={cardinalityEndX}
              y={cardinalityEndY}
              text={cardinalityEnd}
            />
          </>
        )}
        {handle && !layout.readOnly && (
          <circle
            cx={handle.x}
            cy={handle.y}
            r={7}
            className={`relationship-handle${
              isSelected || dragBendX !== null ? " relationship-selected" : ""
            }`}
            data-testid={`relationship-handle-${data.name}`}
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onLostPointerCapture={() => {
              dragRef.current = null;
              setDragBendX(null);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              edit();
            }}
          >
            <title>{t("drag_to_move_line")}</title>
          </circle>
        )}
      </g>
      <SideSheet
        title={t("edit")}
        size="small"
        visible={
          selectedElement.element === ObjectType.RELATIONSHIP &&
          selectedElement.id === data.id &&
          selectedElement.open &&
          !layout.sidebar
        }
        onCancel={() => {
          setSelectedElement((prev) => ({
            ...prev,
            open: false,
          }));
        }}
        style={{ paddingBottom: "16px" }}
      >
        <div className="sidesheet-theme">
          <RelationshipInfo data={data} />
        </div>
      </SideSheet>
    </>
  );
}

function CardinalityLabel({ x, y, text, r = 12, padding = 14 }) {
  const [textWidth, setTextWidth] = useState(0);
  const textRef = useRef(null);

  useEffect(() => {
    if (textRef.current) {
      const bbox = textRef.current.getBBox();
      setTextWidth(bbox.width);
    }
  }, [text]);

  return (
    <g>
      <rect
        x={x - textWidth / 2 - padding / 2}
        y={y - r}
        rx={r}
        ry={r}
        width={textWidth + padding}
        height={r * 2}
        fill="grey"
        className="group-hover:fill-sky-600"
      />
      <text
        ref={textRef}
        x={x}
        y={y}
        fill="white"
        strokeWidth="0.5"
        textAnchor="middle"
        alignmentBaseline="middle"
      >
        {text}
      </text>
    </g>
  );
}
