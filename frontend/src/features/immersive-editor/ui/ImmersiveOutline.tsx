import {
  Fragment,
  createElement,
  useEffect,
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

const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 190;
const MAX_WIDTH = 360;

function boundedWidth(width: number) {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
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

function OutlineNodes({
  activeIndex,
  depth,
  nodes,
  onSelect
}: Readonly<{
  activeIndex: number | null;
  depth: number;
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
        return (
          <div key={`${node.item.position}-${node.item.index}`}>
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
              <OutlineNodes
                activeIndex={activeIndex}
                depth={depth + 1}
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

export function ImmersiveOutline({
  activeIndex,
  direction,
  items,
  open,
  strings,
  onOpenChange,
  onSelect
}: Readonly<{
  activeIndex: number | null;
  direction: 'ltr' | 'rtl';
  items: ReadonlyArray<ImmersiveOutlineItem>;
  open: boolean;
  strings: ImmersiveStrings;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: ImmersiveOutlineItem) => void;
}>) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const outlineRef = useRef<HTMLElement>(null);
  const releaseDragRef = useRef<(() => void) | null>(null);

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
    event.preventDefault();
    releaseDragRef.current?.();
    const documentRef = outlineRef.current?.ownerDocument;
    if (!documentRef) throw new Error('immersive-outline-document-unavailable');
    const resizer = event.currentTarget;
    const pointerId = event.pointerId;
    const startWidth = width;
    const startX = event.clientX;
    const previousCursor = documentRef.body.style.cursor;
    const previousSelection = documentRef.body.style.userSelect;
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const physicalDelta = moveEvent.clientX - startX;
      const logicalDelta = 'rtl' === direction ? -physicalDelta : physicalDelta;
      setWidth(boundedWidth(startWidth + logicalDelta));
    };
    const release = (releaseEvent?: globalThis.PointerEvent) => {
      if (releaseEvent && releaseEvent.pointerId !== pointerId) return;
      documentRef.removeEventListener('pointermove', onMove);
      documentRef.removeEventListener('pointerup', release);
      documentRef.removeEventListener('pointercancel', release);
      if (resizer.hasPointerCapture?.(pointerId)) {
        resizer.releasePointerCapture(pointerId);
      }
      documentRef.body.style.cursor = previousCursor;
      documentRef.body.style.userSelect = previousSelection;
      releaseDragRef.current = null;
    };
    releaseDragRef.current = release;
    documentRef.body.style.cursor = 'col-resize';
    documentRef.body.style.userSelect = 'none';
    resizer.setPointerCapture?.(pointerId);
    documentRef.addEventListener('pointermove', onMove);
    documentRef.addEventListener('pointerup', release);
    documentRef.addEventListener('pointercancel', release);
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLHRElement>) => {
    const physicalStep =
      'ArrowLeft' === event.key ? -10 : 'ArrowRight' === event.key ? 10 : 0;
    if (physicalStep) {
      event.preventDefault();
      const logicalStep = 'rtl' === direction ? -physicalStep : physicalStep;
      setWidth((current) => boundedWidth(current + logicalStep));
    } else if ('Home' === event.key) {
      event.preventDefault();
      setWidth(DEFAULT_WIDTH);
    }
  };

  return (
    <Fragment>
      <aside
        ref={outlineRef}
        className="easymde-immersive-outline"
        aria-label={strings.outline}
        style={{ width }}
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
          {items.length ? (
            <OutlineNodes
              activeIndex={activeIndex}
              depth={0}
              nodes={buildOutlineTree(items)}
              onSelect={onSelect}
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
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        className="easymde-immersive-outline-resizer"
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        onKeyDown={resizeWithKeyboard}
      />
    </Fragment>
  );
}
