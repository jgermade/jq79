// DOM helpers: tiny query/create utilities, also injected into component
// scripts as $, $$ and $create

// $(selector) queries the document; $(el, selector) queries within el. The
// selector is required in the element form - an empty one is a SyntaxError
export function $(selector: string): Element | null
export function $(el: Element, selector: string): Element | null
export function $(selectorOrEl: string | Element, selector?: string): Element | null {
  return typeof selectorOrEl === "string"
    ? document.querySelector(selectorOrEl)
    : selectorOrEl.querySelector(selector!)
}

export function $$(selector: string): Element[]
export function $$(el: Element, selector: string): Element[]
export function $$(selectorOrEl: string | Element, selector?: string): Element[] {
  return Array.from(
    typeof selectorOrEl === "string"
      ? document.querySelectorAll(selectorOrEl)
      : selectorOrEl.querySelectorAll(selector!)
  )
}

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

// la política de destinos: decide si un href/src ya seguro por protocolo
// puede apuntar a donde apunta. Restringe *sobre* el chequeo de protocolo,
// nunca en su lugar
export type AllowUrl = (url: URL, tag: string, attr: string) => boolean;

export type SanitizeOptions = { allowUrl?: AllowUrl };

const DEFAULT_PORTS: Record<string, string> = { 'https:': '443', 'http:': '80' };

type HostPattern = { host: RegExp; port: string | null };

// "host[:puerto]": `*` casa exactamente UNA etiqueta dns - la regla de los
// certificados TLS, no la de CSP: *.germade.dev casa a.germade.dev, pero ni
// germade.dev (escribe los dos para incluir el apex) ni a.b.germade.dev.
// Sin puerto casa cualquiera; un patrón inválido devuelve null y no casa
// nada - una política rota cierra, no abre
function compileHostPattern(pattern: string): HostPattern | null {
  const match = pattern.trim().toLowerCase().match(/^([a-z\d*][a-z\d.*-]*?)(?::(\d{1,5}|\*))?$/);
  if (!match) return null;
  const [, host, port] = match;
  const labels = host.split('.');
  if (labels.some(label => label !== '*' && !/^[a-z\d-]+$/.test(label))) return null;
  // las etiquetas validadas no llevan metacaracteres de regex, así que no
  // hay nada que escapar; los puntos los pone el join
  const re = new RegExp(`^${labels.map(label => (label === '*' ? '[^.]+' : label)).join('\\.')}$`);
  return { host: re, port: !port || port === '*' ? null : port };
}

// compila una lista de patrones (string separado por comas, o array) en un
// predicado AllowUrl. El puerto comparado es el *efectivo* de la URL (el
// explícito, o el del esquema), así "germade.dev:443" casa https://germade.dev.
// Una URL sin host (mailto:) no casa ningún patrón: los patrones hablan de
// hosts - la forma función de la política puede admitirla si quiere
export const allowedHosts = (patterns: string | string[]): AllowUrl => {
  const compiled = (Array.isArray(patterns) ? patterns : patterns.split(','))
    .map(compileHostPattern)
    .filter((p): p is HostPattern => p !== null);
  return url => {
    const host = url.hostname.toLowerCase();
    const port = url.port || DEFAULT_PORTS[url.protocol] || '';
    return compiled.some(p => p.host.test(host) && (p.port === null || p.port === port));
  };
};

// consulta la política con la URL resuelta contra la página, para que una
// URL relativa se juzgue como el destino same-origin que realmente es. Un
// predicado que lanza, o una URL que no parsea, es un no
function consultAllowUrl(allowUrl: AllowUrl, value: string, tag: string, attr: string): boolean {
  try {
    return !!allowUrl(new URL(value, document.baseURI), tag, attr);
  } catch {
    return false;
  }
}

// el saneado es recursivo, así que la profundidad del input es profundidad
// de pila. 512 es lo que toleran los parsers de los navegadores antes de
// aplanar el anidamiento, con lo que ningún documento legítimo pierde nada -
// y superar el límite lanza un RangeError con nombre, en vez de reventar la
// pila en algún punto indeterminado más arriba
const MAX_SANITIZE_DEPTH = 512;

// copia los hijos de `source` en `target`, saneando los elementos y clonando
// el texto; cualquier otra cosa (comentarios, etc.) se descarta
function appendSanitizedChildren(source: ParentNode, target: HTMLElement, depth: number, allowUrl?: AllowUrl): void {
  if (depth > MAX_SANITIZE_DEPTH) {
    throw new RangeError(`jq79: sanitizeHTML input nests deeper than ${MAX_SANITIZE_DEPTH} elements`);
  }
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const sanitizedChild = sanitizeNode(child as HTMLElement, depth, allowUrl);
      if (sanitizedChild) target.appendChild(sanitizedChild);
    } else if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(child.cloneNode());
    }
  }
}

// sanea un elemento (los llamadores solo pasan nodos ELEMENT_NODE)
function sanitizeNode(node: HTMLElement, depth: number, allowUrl?: AllowUrl): HTMLElement | null {
  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return null; // tag no permitido → se descarta el nodo entero

  const clean = document.createElement(tag);

  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    const allowedForTag = ALLOWED_ATTR[tag]?.has(name);
    const allowedGlobal = ALLOWED_ATTR['*']?.has(name);
    if (!allowedForTag && !allowedGlobal) continue;

    if (name === 'href' || name === 'src') {
      if (!isSafeUrl(attr.value)) continue;
      if (allowUrl && !consultAllowUrl(allowUrl, attr.value, tag, name)) continue;
    }

    clean.setAttribute(name, attr.value);
  }

  // fuerza rel seguro en enlaces (target nunca se copia: no está permitido)
  if (tag === 'a') clean.setAttribute('rel', 'noopener noreferrer');

  appendSanitizedChildren(node, clean, depth + 1, allowUrl);

  return clean;
}

export function sanitizeHTML(html: string, options?: SanitizeOptions): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');

  appendSanitizedChildren(doc.body, container, 0, options?.allowUrl);

  return container.innerHTML;
}