let warnedAboutBetween = false

const classesById = Object.create(null)

// ::- Superclass for editor selections.
class Selection {
  // :: number
  // The lower bound of the selection.
  get from() { return this.$from.pos }

  // :: number
  // The upper bound of the selection.
  get to() { return this.$to.pos }

  constructor($from, $to) {
    // :: ResolvedPos
    // The resolved lower bound of the selection
    this.$from = $from
    // :: ResolvedPos
    // The resolved upper bound of the selection
    this.$to = $to
  }

  // :: bool
  // True if the selection is an empty text selection (head and anchor
  // are the same).
  get empty() {
    return this.from == this.to
  }

  // eq:: (other: Selection) → bool
  // Test whether the selection is the same as another selection.

  // map:: (doc: Node, mapping: Mappable) → Selection
  // Map this selection through a [mappable](#transform.Mappable) thing. `doc`
  // should be the new document, to which we are mapping.

  // toJSON:: () → Object
  // Convert the selection to a JSON representation. When implementing
  // this for a custom selection class, make sure to give the object a
  // `type` property whose value matches the ID under which you
  // [registered](#state.Selection^jsonID) your class.

  // :: (ResolvedPos, number, ?bool) → ?Selection
  // Find a valid cursor or leaf node selection starting at the given
  // position and searching back if `dir` is negative, and forward if
  // negative. When `textOnly` is true, only consider cursor
  // selections.
  static findFrom($pos, dir, textOnly) {
    let inner = $pos.parent.inlineContent ? new TextSelection($pos)
        : findSelectionIn($pos.node(0), $pos.parent, $pos.pos, $pos.index(), dir, textOnly)
    if (inner) return inner

    for (let depth = $pos.depth - 1; depth >= 0; depth--) {
      let found = dir < 0
          ? findSelectionIn($pos.node(0), $pos.node(depth), $pos.before(depth + 1), $pos.index(depth), dir, textOnly)
          : findSelectionIn($pos.node(0), $pos.node(depth), $pos.after(depth + 1), $pos.index(depth) + 1, dir, textOnly)
      if (found) return found
    }
  }

  // :: (ResolvedPos, ?number, ?bool) → Selection
  // Find a valid cursor or leaf node selection near the given
  // position. Searches forward first by default, but if `bias` is
  // negative, it will search backwards first.
  static near($pos, bias = 1, textOnly = false) {
    let result = this.findFrom($pos, bias, textOnly) || this.findFrom($pos, -bias, textOnly)
    if (!result) throw new RangeError("Searching for selection in invalid document " + $pos.node(0))
    return result
  }

  // :: (Node, ?bool) → ?Selection
  // Find the cursor or leaf node selection closest to the start of
  // the given document. When `textOnly` is true, only consider cursor
  // selections.
  static atStart(doc, textOnly) {
    return findSelectionIn(doc, doc, 0, 0, 1, textOnly)
  }

  // :: (Node, ?bool) → ?Selection
  // Find the cursor or leaf node selection closest to the end of
  // the given document. When `textOnly` is true, only consider cursor
  // selections.
  static atEnd(doc, textOnly) {
    return findSelectionIn(doc, doc, doc.content.size, doc.childCount, -1, textOnly)
  }

  static between($anchor, $head, bias) {
    if (!warnedAboutBetween && typeof console != "undefined" && console.warn) {
      warnedAboutBetween = true
      console.warn("Selection.between is now called TextSelection.between")
    }
    return TextSelection.between($anchor, $head, bias)
  }

  // :: (Object, Mapping) → Object
  // Map a JSON object representing this selection through a mapping.
  // Must be implemented for custom selection classes.
  static mapJSON(json, mapping) {
    return classesById[json.type].mapJSON(json, mapping)
  }

  // :: (Node, Object) → Selection
  // Deserialize a JSON representation of a selection.
  static fromJSON(doc, json) {
    let cls = classesById[json.type]
    if (!cls) // Backwards-compat with pre-0.19 JSON format
      cls = json.anchor != null ? TextSelection : NodeSelection
    return cls.fromJSON(doc, json)
  }

  // :: (string, constructor<Selection>)
  // To be able to deserialize selections from JSON, custom selection
  // classes must register themselves with an ID string, so that they
  // can be disambiguated. Try to pick something that's unlikely to
  // clash with classes from other modules.
  static jsonID(id, selectionClass) {
    if (id in classesById) throw new RangeError("Duplicate use of selection JSON ID " + id)
    classesById[id] = selectionClass
    selectionClass.prototype.jsonID = id
    return selectionClass
  }
}
exports.Selection = Selection

// ::- A text selection represents a classical editor
// selection, with a head (the moving side) and anchor (immobile
// side), both of which point into textblock nodes. It can be empty (a
// regular cursor position).
class TextSelection extends Selection {
  // :: number
  // The selection's immobile side (does not move when pressing
  // shift-arrow).
  get anchor() { return this.$anchor.pos }
  // :: number
  // The selection's mobile side (the side that moves when pressing
  // shift-arrow).
  get head() { return this.$head.pos }

  // :: (ResolvedPos, ?ResolvedPos)
  // Construct a text selection.
  constructor($anchor, $head = $anchor) {
    let inv = $anchor.pos > $head.pos
    super(inv ? $head : $anchor, inv ? $anchor : $head)
    // :: ResolvedPos The resolved anchor of the selection.
    this.$anchor = $anchor
    // :: ResolvedPos The resolved head of the selection.
    this.$head = $head
  }

  get inverted() { return this.anchor > this.head }

  eq(other) {
    return other instanceof TextSelection && other.head == this.head && other.anchor == this.anchor
  }

  map(doc, mapping) {
    let $head = doc.resolve(mapping.map(this.head))
    if (!$head.parent.inlineContent) return Selection.near($head)
    let $anchor = doc.resolve(mapping.map(this.anchor))
    return new TextSelection($anchor.parent.inlineContent ? $anchor : $head, $head)
  }

  toJSON() {
    return {type: "text", head: this.head, anchor: this.anchor}
  }

  // :: (Node, number, ?number) → TextSelection
  // Create a text selection from non-resolved positions.
  static create(doc, anchor, head = anchor) {
    let $anchor = doc.resolve(anchor)
    return new this($anchor, head == anchor ? $anchor : doc.resolve(head))
  }

  // :: (ResolvedPos, ResolvedPos, ?number) → TextSelection
  // Return a text selection that spans the given positions or, if
  // they aren't text positions, find a text selection near them.
  // `bias` determines whether the method searches forward (default)
  // or backwards (negative number) first.
  static between($anchor, $head, bias) {
    let dir = $anchor.pos > $head.pos ? -1 : 1
    if (!$head.parent.inlineContent)
      $head = Selection.near($head, bias || -dir, true).$head
    if (!$anchor.parent.inlineContent) {
      $anchor = Selection.near($anchor, dir, true).$anchor
      if (($anchor.pos > $head.pos) != (dir < 0)) $anchor = $head
    }
    return new TextSelection($anchor, $head)
  }

  static fromJSON(doc, json) {
    // This is cautious, because the history will blindly map
    // selections and then try to deserialize them, and the endpoints
    // might not point at appropriate positions anymore (though they
    // are guaranteed to be inside of the document's range).
    return TextSelection.between(doc.resolve(json.anchor), doc.resolve(json.head))
  }

  static mapJSON(json, mapping) {
    return {type: "text", head: mapping.map(json.head), anchor: mapping.map(json.anchor)}
  }
}
exports.TextSelection = TextSelection

Selection.jsonID("text", TextSelection)

// ::- A node selection is a selection that points at a
// single node. All nodes marked [selectable](#model.NodeSpec.selectable)
// can be the target of a node selection. In such an object, `from`
// and `to` point directly before and after the selected node.
class NodeSelection extends Selection {
  // :: (ResolvedPos)
  // Create a node selection. Does not verify the validity of its
  // argument.
  constructor($from) {
    let $to = $from.node(0).resolve($from.pos + $from.nodeAfter.nodeSize)
    super($from, $to)
    // :: Node The selected node.
    this.node = $from.nodeAfter
  }

  eq(other) {
    return other instanceof NodeSelection && this.from == other.from
  }

  map(doc, mapping) {
    let from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1)
    let $from = doc.resolve(from.pos), node = $from.nodeAfter
    if (!from.deleted && !to.deleted && node && to.pos == from.pos + node.nodeSize && NodeSelection.isSelectable(node))
      return new NodeSelection($from)
    return Selection.near($from)
  }

  toJSON() {
    return {type: "node", node: this.from, after: this.to}
  }

  // :: (Node, number, ?number) → TextSelection
  // Create a node selection from non-resolved positions.
  static create(doc, from) {
    return new this(doc.resolve(from))
  }

  // :: (Node) → bool
  // Determines whether the given node may be selected as a node
  // selection.
  static isSelectable(node) {
    return !node.isText && node.type.spec.selectable !== false
  }

  static fromJSON(doc, json) {
    let $pos = doc.resolve(json.node), after = $pos.nodeAfter
    if (after && json.after == json.pos + after.nodeSize && NodeSelection.isSelectable(after)) return new NodeSelection($pos)
    else return Selection.near($pos)
  }

  static mapJSON(json, mapping) {
    return {type: "node", node: mapping.map(json.node), after: mapping.map(json.after, -1)}
  }
}
exports.NodeSelection = NodeSelection

Selection.jsonID("node", NodeSelection)

// FIXME we'll need some awareness of text direction when scanning for selections

// Try to find a selection inside the given node. `pos` points at the
// position where the search starts. When `text` is true, only return
// text selections.
function findSelectionIn(doc, node, pos, index, dir, text) {
  if (node.inlineContent) return TextSelection.create(doc, pos)
  for (let i = index - (dir > 0 ? 0 : 1); dir > 0 ? i < node.childCount : i >= 0; i += dir) {
    let child = node.child(i)
    if (!child.isAtom) {
      let inner = findSelectionIn(doc, child, pos + dir, dir < 0 ? child.childCount : 0, dir, text)
      if (inner) return inner
    } else if (!text && NodeSelection.isSelectable(child)) {
      return NodeSelection.create(doc, pos - (dir < 0 ? child.nodeSize : 0))
    }
    pos += child.nodeSize * dir
  }
}
