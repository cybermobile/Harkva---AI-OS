/**
 * slash-commands.js
 * Provides a slash command dropdown menu for the markdown editor.
 * Type "/" to open the menu, then filter by typing. Select with
 * arrow keys + Enter, or click.
 */

let textarea = null;
let menu = null;
let activeIndex = 0;
let visible = false;
let filterText = '';

const COMMANDS = [
  { label: 'Heading 1',       icon: 'H1',  insert: '# ',            block: true },
  { label: 'Heading 2',       icon: 'H2',  insert: '## ',           block: true },
  { label: 'Heading 3',       icon: 'H3',  insert: '### ',          block: true },
  { label: 'Bold',            icon: 'B',   insert: '****',          cursor: -2 },
  { label: 'Italic',          icon: 'I',   insert: '__',            cursor: -1 },
  { label: 'Strikethrough',   icon: 'S',   insert: '~~~~',          cursor: -2 },
  { label: 'Bullet List',     icon: '•',   insert: '- ',            block: true },
  { label: 'Numbered List',   icon: '1.',  insert: '1. ',           block: true },
  { label: 'Checkbox',        icon: '☑',   insert: '- [ ] ',        block: true },
  { label: 'Blockquote',      icon: '>',   insert: '> ',            block: true },
  { label: 'Code Block',      icon: '</>',  insert: '```\n\n```',    cursor: -4 },
  { label: 'Inline Code',     icon: '`',   insert: '``',            cursor: -1 },
  { label: 'Horizontal Rule', icon: '―',   insert: '\n---\n',       block: true },
  { label: 'Link',            icon: 'Ln',  insert: '[](url)',        cursor: -6 },
  { label: 'Image',           icon: 'Img', insert: '![alt](url)',   cursor: -5 },
  {
    label: 'Table',
    icon: '⊞',
    insert: '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n| Cell     | Cell     | Cell     |\n',
    block: true,
  },
  { label: 'Divider',         icon: '┄',   insert: '\n***\n',       block: true },
  { label: 'Callout',         icon: '!!',  insert: '> **Note:** ',  block: true },
];

function createMenu() {
  const el = document.createElement('div');
  el.id = 'slash-menu';
  el.className = 'slash-menu';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
}

function renderItems(filter) {
  const items = getFiltered(filter);
  if (items.length === 0) {
    hide();
    return;
  }

  activeIndex = Math.min(activeIndex, items.length - 1);

  menu.innerHTML = items.map((cmd, i) => `
    <div class="slash-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
      <span class="slash-icon">${cmd.icon}</span>
      <span class="slash-label">${cmd.label}</span>
    </div>
  `).join('');

  // Click handlers
  menu.querySelectorAll('.slash-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = parseInt(el.dataset.index, 10);
      executeCommand(items[idx]);
    });
  });
}

function getFiltered(filter) {
  if (!filter) return COMMANDS;
  const lower = filter.toLowerCase();
  return COMMANDS.filter((c) => c.label.toLowerCase().includes(lower));
}

function positionMenu() {
  if (!textarea) return;
  const rect = textarea.getBoundingClientRect();

  // Get cursor position in textarea
  const text = textarea.value.slice(0, textarea.selectionStart);
  const lines = text.split('\n');
  const lineNum = lines.length;
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22;

  const top = rect.top + (lineNum * lineHeight) - textarea.scrollTop + 4;
  const left = rect.left + 16;

  menu.style.top = Math.min(top, window.innerHeight - 300) + 'px';
  menu.style.left = Math.min(left, window.innerWidth - 220) + 'px';
}

function show() {
  visible = true;
  filterText = '';
  activeIndex = 0;
  menu.style.display = 'block';
  positionMenu();
  renderItems('');
}

function hide() {
  visible = false;
  filterText = '';
  activeIndex = 0;
  if (menu) menu.style.display = 'none';
}

function executeCommand(cmd) {
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  // Find the slash that triggered this
  let slashPos = start - 1 - filterText.length;
  if (slashPos < 0) slashPos = 0;

  // Remove the "/" and any filter text
  const before = value.slice(0, slashPos);
  const after = value.slice(start);

  let insert = cmd.insert;

  // For block-level commands, ensure we're at the start of a line
  if (cmd.block && before.length > 0 && !before.endsWith('\n')) {
    insert = '\n' + insert;
  }

  const newValue = before + insert + after;
  textarea.value = newValue;

  // Position cursor
  let cursorPos = before.length + insert.length;
  if (cmd.cursor) {
    cursorPos += cmd.cursor;
  }

  textarea.selectionStart = cursorPos;
  textarea.selectionEnd = cursorPos;
  textarea.focus();

  // Trigger input event so auto-save / other listeners fire
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  hide();
}

function handleKeyDown(e) {
  if (!visible) return;

  const items = getFiltered(filterText);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = (activeIndex + 1) % items.length;
    renderItems(filterText);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = (activeIndex - 1 + items.length) % items.length;
    renderItems(filterText);
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    if (items[activeIndex]) {
      executeCommand(items[activeIndex]);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hide();
  }
}

function handleInput() {
  if (!textarea || !visible) return;

  const pos = textarea.selectionStart;
  const text = textarea.value.slice(0, pos);

  // Find the last "/" to determine filter text
  const lastSlash = text.lastIndexOf('/');
  if (lastSlash === -1) {
    hide();
    return;
  }

  const afterSlash = text.slice(lastSlash + 1);

  // If there's a space or newline between slash and cursor, close menu
  if (/[\n\r]/.test(afterSlash)) {
    hide();
    return;
  }

  filterText = afterSlash;
  activeIndex = 0;
  renderItems(filterText);
  positionMenu();
}

function handleKeyPress(e) {
  if (e.key === '/' && !visible) {
    // Small delay so the "/" is inserted first
    setTimeout(() => {
      show();
    }, 0);
  }
}

/**
 * Attach slash commands to a textarea element.
 * @param {HTMLTextAreaElement} el
 */
export function attach(el) {
  if (!el) return;
  textarea = el;

  if (!menu) {
    menu = createMenu();
  }

  textarea.addEventListener('keydown', handleKeyDown);
  textarea.addEventListener('input', handleInput);
  textarea.addEventListener('keypress', handleKeyPress);

  // Close on blur (with delay so clicks on menu register)
  textarea.addEventListener('blur', () => {
    setTimeout(() => hide(), 150);
  });

  // Close on scroll
  textarea.addEventListener('scroll', () => {
    if (visible) positionMenu();
  });
}

/**
 * Detach slash commands from the current textarea.
 */
export function detach() {
  if (textarea) {
    textarea.removeEventListener('keydown', handleKeyDown);
    textarea.removeEventListener('input', handleInput);
    textarea.removeEventListener('keypress', handleKeyPress);
  }
  hide();
  textarea = null;
}
