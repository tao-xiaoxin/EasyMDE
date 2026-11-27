import { TASK_LIST_CHECKBOX_CLONES } from './wechat-clone-metadata';
import {
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
  TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS
} from './wechat-task-caption';
import { replaceDeclarations } from './wechat-style-declarations';

/**
 * Task checkboxes are the portable marker for task-list items. Native WeChat
 * applies its own list marker during Save and strips declaration priority from
 * pasted styles, so a copied `list-style-type:disc` left before an appended
 * `none!important` re-appears as a second marker beside the checkbox. Replace
 * the declarations outright so a task UL/LI never carries both values, and
 * leave ordinary ordered/unordered list markers untouched.
 */
export function normalizePortableTaskListMarkers(root: HTMLElement): void {
  const taskStructure = new Set<Element>();
  root.querySelectorAll('*').forEach((element) => {
    if (!TASK_LIST_CHECKBOX_CLONES.has(element)) return;
    const taskItem = element.closest('li');
    if (!taskItem) return;
    taskStructure.add(taskItem);
    const taskList = taskItem.parentElement;
    if (taskList && ['UL', 'OL'].includes(taskList.tagName)) taskStructure.add(taskList);
  });
  taskStructure.forEach((element) => {
    replaceDeclarations(element, ['list-style-type:none', 'list-style-image:none'], true);
  });
}

/**
 * Moves one cloned structure element into a destination-safe `section` while
 * keeping every descendant and every WeakSet/WeakMap identity intact. The old
 * element stays the registry key for a registered task caption so caption
 * resolution can follow the replacement to the new section.
 */
function relocateStructureToSection(document: Document, element: Element): Element {
  const section = document.createElement('section');
  Array.from(element.attributes).forEach((attribute) => {
    section.setAttribute(attribute.name, attribute.value);
  });
  // The source list container and every task item must lose their native list
  // semantics. Copying the attributes alone would keep `display:list-item` or a
  // theme `list-style-type` on the section, which can still compute a marker in
  // the destination; replace those declarations while the copied padding,
  // margins, width, and every other projected declaration stay in place.
  replaceDeclarations(section, ['display:block', 'list-style-type:none', 'list-style-image:none'], true);
  // Register every converted structure unconditionally: a loose task item's
  // caption parent is its paragraph, so the task item itself is not a caption
  // migration candidate, yet caption resolution still owns the original task
  // item (`run.cloneTaskItem`) and must follow it to the new section instead of
  // reading a detached element.
  TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.set(element, section);
  const ownerSequence = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(element);
  if (ownerSequence) TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.set(section, ownerSequence);
  while (element.firstChild) section.appendChild(element.firstChild);
  element.replaceWith(section);
  return section;
}

/**
 * Destination-safe block projection for complete task lists.
 *
 * Native WeChat Save imports `ul/ol` markup with its own list model: a task
 * list pasted as a list loses its static task marker and comes back as a
 * rebuilt native list item, which the reproduced evidence shows as a native
 * bullet plus checkbox after Save. A complete task list therefore leaves the
 * clipboard as block `section` structure. The list and each of its task items
 * are replaced by sections that carry the original attributes (`start`,
 * `reversed`, `value`, classes, projected declarations) and adopt the original
 * children, so every element registered in the clone metadata, every static
 * allocation, and every generated task caption keeps its identity and its
 * recorded structure resolution.
 *
 * Ordinary lists are untouched. A list that mixes task and ordinary items has
 * no single lossless destination structure yet: projecting only its task items
 * would leave `ul > section` (invalid), and splitting it into task sections
 * plus rebuilt ordinary list runs needs a legal block container and preserved
 * ordered numbering. Such a list therefore keeps its current list markup
 * instead of failing the Copy or emitting invalid structure; the mixed-list
 * projection remains UNVERIFIED. Nested lists follow the same rules
 * independently: a nested ordinary list stays a list inside its task section,
 * and a nested complete task list is projected on its own.
 */
export function projectCompleteTaskListStructures(root: HTMLElement): void {
  const document = root.ownerDocument;
  const taskItems = new Set<Element>();
  root.querySelectorAll('*').forEach((element) => {
    if (!TASK_LIST_CHECKBOX_CLONES.has(element)) return;
    const item = element.parentElement?.closest('li');
    if (item && item !== element && root.contains(item)) taskItems.add(item);
  });
  if (!taskItems.size) return;
  const lists = new Set<Element>();
  taskItems.forEach((item) => {
    const list = item.parentElement;
    if (list && root.contains(list) && list !== root && ['UL', 'OL'].includes(list.tagName)) {
      lists.add(list);
    }
  });
  lists.forEach((list) => {
    const children = Array.from(list.children);
    const taskChildCount = children.filter((child) => taskItems.has(child)).length;
    if (!children.length || !taskChildCount) return;
    // A list mixing task and ordinary items keeps its list markup: the copy
    // stays lossless and legal rather than emitting `ul > section`.
    if (children.some((child) => !taskItems.has(child))) return;
    children.forEach((child) => {
      relocateStructureToSection(document, child);
    });
    relocateStructureToSection(document, list);
  });
}
