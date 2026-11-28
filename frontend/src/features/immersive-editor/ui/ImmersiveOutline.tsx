import { startColumnResize } from '../../../shared/dom/column-resize';
import {
  Fragment,
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react';
import {
  BarChart3,
  ChevronsLeft,
  Clock,
  Code2,
  Database,
  FileText,
  GitBranch,
  Image,
  Link2,
  ListChecks,
  ListCollapse,
  Minus,
  PieChart,
  Quote,
  Sigma,
  Table,
  Workflow,
  X
} from '../../../generated/lucide-icons';
import type { LucideIcon } from '../../../generated/lucide-icons';
import {
  buildOutlineTree,
  type ImmersiveOutlineItem,
  type ImmersiveOutlineNode
} from '../immersive-editor';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

export const COMPACT_OUTLINE_MAX_WIDTH = 782;

const INTERMEDIATE_OUTLINE_MAX_VIEWPORT = 1080;
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 190;
const MAX_WIDTH = 360;
const INTERMEDIATE_MIN_WIDTH = 160;
const INTERMEDIATE_MAX_WIDTH = 220;
const INTERMEDIATE_VIEWPORT_RATIO = 0.24;
const OVERLAY_HORIZONTAL_GUTTER = 22.5;
const EMPTY_OUTLINE_KEYS = new Map<ImmersiveOutlineItem, string>();
const EMPTY_OUTLINE_TREE: ReadonlyArray<ImmersiveOutlineNode> = [];

type OutlineWidthBounds = Readonly<{
  max: number;
  min: number;
}>;

function outlineWidthBounds(viewportWidth?: number): OutlineWidthBounds {
  if (
    undefined === viewportWidth
    || !Number.isFinite(viewportWidth)
    || viewportWidth <= 0
  ) {
    return { max: MAX_WIDTH, min: MIN_WIDTH };
  }
  if (viewportWidth <= COMPACT_OUTLINE_MAX_WIDTH) {
    return {
      max: Math.max(
        0,
        Math.min(
          DEFAULT_WIDTH,
          Math.floor(viewportWidth - OVERLAY_HORIZONTAL_GUTTER)
        )
      ),
      min: 0
    };
  }
  if (viewportWidth <= INTERMEDIATE_OUTLINE_MAX_VIEWPORT) {
    return {
      max: Math.max(
        INTERMEDIATE_MIN_WIDTH,
        Math.min(
          INTERMEDIATE_MAX_WIDTH,
          Math.floor(viewportWidth * INTERMEDIATE_VIEWPORT_RATIO)
        )
      ),
      min: INTERMEDIATE_MIN_WIDTH
    };
  }
  return { max: MAX_WIDTH, min: MIN_WIDTH };
}

function boundedWidth(width: number, bounds: OutlineWidthBounds): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(width)));
}

const MERMAID_ICON_RULES: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/饼图/u, PieChart],
  [/甘特/u, BarChart3],
  [/状态图|时间线/u, Clock],
  [/关系图|er\s/u, Database],
  [/思维导图/u, GitBranch]
];

const OUTLINE_ICON_RULES: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/引用式链接|引用式/u, Link2],
  [/链接与图片|图片/u, Image],
  [/引用块|blockquote/u, Quote],
  [/无序|有序|任务列表/u, ListChecks],
  [/分隔线|\bhr\b|rule/u, Minus],
  [/表格|table/u, Table],
  [/行内代码|代码块|html|标签/u, Code2],
  [/数学|公式|矩阵|方程|统计|softmax|前向传播/u, Sigma],
  [/折叠内容|折叠/u, ListCollapse],
  [/综合示例|监控|指标|错误率|dashboard/u, BarChart3]
];

function outlineIcon(title: string): LucideIcon {
  const normalized = title.toLowerCase();
  if (/mermaid/u.test(normalized)) {
    for (const [pattern, icon] of MERMAID_ICON_RULES) {
      if (pattern.test(normalized)) return icon;
    }
    return Workflow;
  }
  for (const [pattern, icon] of OUTLINE_ICON_RULES) {
    if (pattern.test(normalized)) return icon;
  }
  return FileText;
}

function buildOutlineItemKeys(
  items: ReadonlyArray<ImmersiveOutlineItem>
): ReadonlyMap<ImmersiveOutlineItem, string> {
  const occurrences = new Map<string, number>();
  const keys = new Map<ImmersiveOutlineItem, string>();
  for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = items[itemIndex];
    if (!item) throw new Error('immersive-outline-item-missing');
    const signature = JSON.stringify([item.level, item.text]);
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    keys.set(item, `${signature}:${occurrence}`);
  }
  return keys;
}

function sameOutlinePresentation(
  left: ReadonlyArray<ImmersiveOutlineItem>,
  right: ReadonlyArray<ImmersiveOutlineItem>
): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const candidate = right[index];
      return candidate?.index === item.index
        && candidate.level === item.level
        && candidate.text === item.text;
    });
}

function OutlineNodes({
  activeIndex,
  depth,
  itemKeys,
  nodes,
  onSelect
}: Readonly<{
  activeIndex: number | null;
  depth: number;
  itemKeys: ReadonlyMap<ImmersiveOutlineItem, string>;
  nodes: ReadonlyArray<ImmersiveOutlineNode>;
  onSelect: (item: ImmersiveOutlineItem) => void;
}>) {
  return (
    <div className={`easymde-immersive-outline-level is-depth-${depth}`}>
      {nodes.map((node) => {
        const active = activeIndex === node.item.index;
        const topLevel = 0 === depth;
        const Icon = topLevel ? outlineIcon(node.item.text) : null;
        const numbered = topLevel
          ? /^(\d+\.)\s*(.*)$/u.exec(node.item.text)
          : null;
        const itemKey = itemKeys.get(node.item);
        if (undefined === itemKey) {
          throw new Error('immersive-outline-item-key-missing');
        }
        return (
          <div key={itemKey}>
            <button
              type="button"
              className={`${active ? 'is-active ' : ''}is-level-${node.item.level}${topLevel ? ' is-top-level' : ''}`}
              aria-current={active ? 'location' : undefined}
              onClick={() => onSelect(node.item)}
            >
              {!topLevel ? <span className="easymde-immersive-outline-elbow" /> : null}
              {Icon ? (
                <Icon className="easymde-immersive-outline-icon" size={16} strokeWidth={2} />
              ) : (
                <span className="easymde-immersive-outline-dash" aria-hidden="true">—</span>
              )}
              <span>
                {numbered ? (
                  <Fragment>
                    <b>{numbered[1]}</b>{' '}{numbered[2]}
                  </Fragment>
                ) : node.item.text}
              </span>
            </button>
            {node.children.length ? (
              <MemoizedOutlineNodes
                activeIndex={activeIndex}
                depth={depth + 1}
                itemKeys={itemKeys}
                nodes={node.children}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const MemoizedOutlineNodes = memo(OutlineNodes);

export const ImmersiveOutline = memo(function ImmersiveOutline({
  activeIndex,
  direction,
  items,
  open,
  strings,
  viewportWidth,
  onOpenChange,
  onSelect
}: Readonly<{
  activeIndex: number | null;
  direction: 'ltr' | 'rtl';
  items: ReadonlyArray<ImmersiveOutlineItem>;
  open: boolean;
  strings: ImmersiveStrings;
  viewportWidth?: number | undefined;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: ImmersiveOutlineItem) => void;
}>) {
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const bounds = outlineWidthBounds(viewportWidth);
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const effectiveWidth = boundedWidth(preferredWidth, bounds);
  const outlineRef = useRef<HTMLElement>(null);
  const releaseDragRef = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  const latestItemsRef = useRef(items);
  const stableItemsRef = useRef(items);
  onSelectRef.current = onSelect;
  latestItemsRef.current = items;
  const stableItems = useMemo(() => {
    const previous = stableItemsRef.current;
    if (previous === items || sameOutlinePresentation(previous, items)) {
      return previous;
    }
    stableItemsRef.current = items;
    return items;
  }, [items]);
  const selectItem = useCallback(
    (item: ImmersiveOutlineItem) => {
      const current = latestItemsRef.current.find(
        (candidate) => candidate.index === item.index
      );
      if (
        !current
        || current.level !== item.level
        || current.text !== item.text
      ) {
        throw new Error('immersive-outline-item-stale');
      }
      onSelectRef.current(current);
    },
    []
  );
  const outlineItemKeys = useMemo(
    () => open ? buildOutlineItemKeys(stableItems) : EMPTY_OUTLINE_KEYS,
    [open, stableItems]
  );
  const outlineTree = useMemo(
    () => open ? buildOutlineTree(stableItems) : EMPTY_OUTLINE_TREE,
    [open, stableItems]
  );

  useEffect(
    () => () => {
      releaseDragRef.current?.();
    },
    []
  );

  useEffect(() => {
    if (!open) releaseDragRef.current?.();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        className="easymde-immersive-outline-show"
        onClick={() => onOpenChange(true)}
        aria-label={strings.showOutline}
        title={strings.showOutline}
      >
        <ChevronsLeft size={16} strokeWidth={2} />
      </button>
    );
  }

  const startResize = (event: ReactPointerEvent<HTMLHRElement>) => {
    if ('mouse' === event.pointerType && 0 !== event.button) return;
    event.preventDefault();
    if (releaseDragRef.current) return;
    const resizer = event.currentTarget;
    const pointerId = event.pointerId;
    const startWidth = effectiveWidth;
    const startX = event.clientX;
    releaseDragRef.current = startColumnResize(resizer, pointerId, (clientX) => {
      const physicalDelta = clientX - startX;
      const logicalDelta = 'rtl' === direction ? -physicalDelta : physicalDelta;
      setPreferredWidth(boundedWidth(startWidth + logicalDelta, boundsRef.current));
    }, () => {
      releaseDragRef.current = null;
    });
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLHRElement>) => {
    const physicalStep =
      'ArrowLeft' === event.key ? -10 : 'ArrowRight' === event.key ? 10 : 0;
    if (physicalStep) {
      event.preventDefault();
      const logicalStep = 'rtl' === direction ? -physicalStep : physicalStep;
      setPreferredWidth((current) =>
        boundedWidth(
          boundedWidth(current, boundsRef.current) + logicalStep,
          boundsRef.current
        )
      );
    } else if ('Home' === event.key) {
      event.preventDefault();
      setPreferredWidth(boundedWidth(DEFAULT_WIDTH, boundsRef.current));
    }
  };

  return (
    <Fragment>
      <aside
        ref={outlineRef}
        className="easymde-immersive-outline"
        aria-label={strings.outline}
        style={{ width: effectiveWidth }}
      >
        <div className="easymde-immersive-outline-title">
          <span>{strings.outline}</span>
          <button
            type="button"
            className="easymde-immersive-outline-close"
            onClick={() => onOpenChange(false)}
            aria-label={strings.hideOutline}
            title={strings.hideOutline}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <div className="easymde-immersive-outline-tree">
          {stableItems.length ? (
            <MemoizedOutlineNodes
              activeIndex={activeIndex}
              depth={0}
              itemKeys={outlineItemKeys}
              nodes={outlineTree}
              onSelect={selectItem}
            />
          ) : (
            <p className="easymde-immersive-outline-empty">{strings.noHeadings}</p>
          )}
        </div>
        <div className="easymde-immersive-outline-footer">
          <button type="button" onClick={() => onOpenChange(false)}>
            <ChevronsLeft size={13} strokeWidth={2} />
            {strings.hideOutline}
          </button>
        </div>
      </aside>
      <hr
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={strings.resizeOutline}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={effectiveWidth}
        className="easymde-immersive-outline-resizer"
        onPointerDown={startResize}
        onDoubleClick={() =>
          setPreferredWidth(boundedWidth(DEFAULT_WIDTH, boundsRef.current))
        }
        onKeyDown={resizeWithKeyboard}
      />
    </Fragment>
  );
});
