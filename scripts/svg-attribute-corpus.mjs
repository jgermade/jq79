// The corpus both the cross-engine check and tests/renderComponent.test.ts use.
//
// These are test corpora, not a shipped table - src/jq79.ts ships no list of
// names at all, which is the whole point of TODOS/2026-08-25.svg-attribute-names.md.
// Nothing depends on them being complete: a name missing here is a name nobody
// checked, not a name that renders wrong.

// SVG's camelCase attribute names. This list is a test corpus, not a shipped
// table - nothing depends on it being complete, and an entry that no engine
// adjusts is reported rather than assumed wrong
export const CAMEL_NAMES = `viewBox preserveAspectRatio baseProfile contentScriptType contentStyleType
zoomAndPan externalResourcesRequired requiredFeatures requiredExtensions systemLanguage
gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform
clipPathUnits maskUnits maskContentUnits filterUnits primitiveUnits filterRes
stdDeviation baseFrequency numOctaves stitchTiles surfaceScale specularConstant specularExponent
diffuseConstant kernelMatrix kernelUnitLength edgeMode targetX targetY preserveAlpha
xChannelSelector yChannelSelector tableValues limitingConeAngle pointsAtX pointsAtY pointsAtZ
markerUnits markerWidth markerHeight refX refY textLength lengthAdjust startOffset
pathLength attributeName attributeType calcMode keyTimes keySplines keyPoints repeatCount repeatDur
viewTarget glyphRef`.split(/\s+/)

// Every dashed name that must reach the DOM exactly as written. The collision
// check asks the table for their DE-DASHED form, because that is the question
// the resolution actually asks - `stroke-width` is looked up as `strokewidth`
export const DASHED_NAMES = `alignment-baseline baseline-shift clip-path clip-rule color-interpolation
color-interpolation-filters color-profile color-rendering dominant-baseline enable-background
fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust
font-stretch font-style font-variant font-weight glyph-orientation-horizontal
glyph-orientation-vertical image-rendering letter-spacing lighting-color marker-end marker-mid
marker-start mask-type overline-position paint-order pointer-events shape-rendering stop-color
stop-opacity stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit
stroke-opacity stroke-width text-anchor text-decoration text-rendering transform-origin
underline-position unicode-bidi vector-effect vertical-align word-spacing writing-mode
data-foo data-user-id aria-label aria-hidden aria-describedby`.split(/\s+/)

// Names with no dash that must also reach the DOM as written. The resolution
// looks every foreign name up, not only the dashed ones - `:viewbox` is a
// spelling somebody writes and the parser adjusts it - so these are the other
// half of the collision question
export const UNDASHED_NAMES = `fill stroke opacity cx cy r rx ry x y x1 y1 x2 y2 width height d points
transform href id class style in in2 result mode operator values type dur begin end from to by fr offset
rotate scale seed radius k1 k2 k3 k4 order divisor bias azimuth elevation exponent intercept slope
amplitude media method spacing side restart accumulate additive orient overflow cursor display
visibility filter mask color direction max min name target version clip cap decelerate descent local
string unicode`.split(/\s+/)
