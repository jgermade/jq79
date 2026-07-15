# Untrusted HTML

[Attributes](#01-basics/04-attributes) introduced `:html`, and the sanitizer it
runs everything through. The sanitizer asks *how*: whatever executes is gone —
`<script>`, event handlers, `javascript:` URLs — along with any tag or attribute
not on a small allowlist. That's the XSS defense, and it is not negotiable: no
option can re-admit what it blocks.

What it never asks is *where*. A phishing link, or a tracking pixel (an
`<img src>` fires a request — and hands over the reader's IP — without anyone
clicking), travels on an impeccable `https:` and sails straight through.
Restricting destinations is `:html.allowed`:

```html
<div :html="comment.body" :html.allowed="['germade.dev', '*.germade.dev']"></div>
```

The value is an expression like any other `:` attribute — host patterns (an
array, or one comma-separated string), or a function `(url, tag, attr) =>
boolean` for what patterns can't say. It's evaluated in the same effect as
`:html`, so a policy kept in the store updates the content the moment it
changes. `*` stands for exactly one DNS label: `*.germade.dev` covers
`docs.germade.dev` but not `germade.dev` — list both. A rejected `href`/`src`
is stripped; the element and its text stay. And a broken policy fails
*closed*: an invalid pattern matches nothing, an expression that evaluates to
`undefined` denies everything.

The style block below makes the stakes visible: every live link prints its
real destination after its text, and the tracking pixel is painted red.

> **Your turn:** mallory's `javascript:` link and `onclick` are already dead —
> the sanitizer never let them in. But trudy's phishing link and her pixel are
> alive, because their protocols are clean. Add
> `:html.allowed="['germade.dev', '*.germade.dev']"` to the `.body` div and
> watch every destination the site doesn't vouch for disappear — ada's docs
> link is the one that keeps its `href`.

The policy is per element, so different zones of one page can trust different
destinations — the one thing a page-wide `Content-Security-Policy` can't
express. Set one anyway, as the floor for everything that never went through
the sanitizer: the two compose, and the stricter one wins.
