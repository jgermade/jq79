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
