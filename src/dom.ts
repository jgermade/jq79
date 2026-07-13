// DOM helpers: tiny query/create utilities, also injected into component
// scripts as $, $$ and $create

export const $ = (selectorOrEl: string | Element, selector?: string) => 
  typeof selectorOrEl === "string"
    ? document.querySelector(selectorOrEl)
    : selectorOrEl.querySelector(selector || "")

export const $$ = (selectorOrEl: string | Element, selector?: string) => Array.from(
  typeof selectorOrEl === "string"
    ? document.querySelectorAll(selectorOrEl)
    : selectorOrEl.querySelectorAll(selector || "")
)

// $create(tag, attrs): attrs are set as attributes, except className, which
// may be a string or an array of class names.
export const $create = (tag: string, attrs: Record<string, any> = {}): HTMLElement => {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'className') {
      el.className = Array.isArray(value) ? value.join(' ') : value;
    } else if (name === 'textContent') {
      el.textContent = value;
    } else if (name === 'children') {
      for (const child of value) {
        el.appendChild(child);
      }
    } else {
      el.setAttribute(name, value);
    }
  }
  return el;
};

const ALLOWED_TAGS = new Set([
  'a', 'b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'span', 'div', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'img'
]);

const ALLOWED_ATTR: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt']),
  '*': new Set(['class']), // atributos permitidos en cualquier tag
};

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function isSafeUrl(value: string): boolean {
  try {
    // resolver relativo a algo neutro para poder leer el protocolo
    const url = new URL(value, 'https://example.com');
    return SAFE_URL_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeNode(node: HTMLElement): HTMLElement | null {
  // Nodo de texto: siempre seguro, se deja tal cual
  if (node.nodeType === Node.TEXT_NODE) return node;

  // Comentarios y cualquier otra cosa: fuera
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return null; // tag no permitido → se descarta el nodo entero

  const clean = document.createElement(tag);

  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    const allowedForTag = ALLOWED_ATTR[tag]?.has(name);
    const allowedGlobal = ALLOWED_ATTR['*']?.has(name);
    if (!allowedForTag && !allowedGlobal) continue;

    if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) continue;

    clean.setAttribute(name, attr.value);
  }

  // fuerza rel seguro en enlaces
  if (tag === 'a') {
    clean.setAttribute('rel', 'noopener noreferrer');
    if (clean.hasAttribute('target')) clean.removeAttribute('target');
  }

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const sanitizedChild = sanitizeNode(child as HTMLElement);
      if (sanitizedChild) clean.appendChild(sanitizedChild);
    } else if (child.nodeType === Node.TEXT_NODE) {
      clean.appendChild(child.cloneNode());
    }
  }

  return clean;
}

export function sanitizeHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');

  for (const child of Array.from(doc.body.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const sanitizedChild = sanitizeNode(child as HTMLElement);
      if (sanitizedChild) container.appendChild(sanitizedChild);
    } else if (child.nodeType === Node.TEXT_NODE) {
      container.appendChild(child.cloneNode());
    }
  }

  return container.innerHTML;
}