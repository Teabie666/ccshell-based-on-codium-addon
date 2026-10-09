/**
 * Find inside a webview, driven by the shell's find widget. Matches are painted with the
 * CSS Custom Highlight API using the `find-highlight` / `current-find-highlight` names
 * VS Code's default webview styles already define, so they take the theme's colors.
 *
 * (Chromium's webContents.findInPage is not used: with the find input living in the same
 * page, it fights the input for focus and silently drops requests.)
 */

import type { FindDirection } from '../../platform/protocol';

const ALL_MATCHES = 'find-highlight';
const CURRENT_MATCH = 'current-find-highlight';

export class InPageFinder {
  private ranges: Range[] = [];
  private index = 0;
  private query = '';
  private matchCase = false;
  /** Set when the page changed since the ranges were collected (Claude keeps streaming). */
  private dirty = false;
  private observer: MutationObserver | undefined;

  constructor(private readonly report: (matches: number, active: number) => void) {}

  find(text: string, matchCase: boolean, direction: FindDirection): void {
    if (!text) {
      this.stop();
      this.report(0, 0);
      return;
    }
    const sameQuery = text === this.query && matchCase === this.matchCase;
    if (!sameQuery || direction === 'restart') {
      this.query = text;
      this.matchCase = matchCase;
      this.recollect(undefined);
    } else if (this.dirty || this.ranges.length === 0) {
      // Content changed: recollect, continuing from where the current match was.
      this.recollect(this.ranges[this.index]);
      this.step(direction);
    } else {
      this.step(direction);
    }
    this.watch();
    this.paint();
    this.report(this.ranges.length, this.ranges.length > 0 ? this.index + 1 : 0);
  }

  stop(): void {
    CSS.highlights?.delete(ALL_MATCHES);
    CSS.highlights?.delete(CURRENT_MATCH);
    this.observer?.disconnect();
    this.observer = undefined;
    this.ranges = [];
    this.query = '';
    this.dirty = false;
  }

  private step(direction: FindDirection): void {
    if (this.ranges.length > 0 && direction !== 'restart') {
      const delta = direction === 'previous' ? -1 : 1;
      this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    }
  }

  /**
   * Collects matches. With `anchor` (the previous current match), the index is put on the
   * first match at or after it, so the caller's next/previous step moves on from there.
   */
  private recollect(anchor: Range | undefined): void {
    this.ranges = collectRanges(document.body, this.query, this.matchCase);
    this.dirty = false;
    this.index = 0;
    if (anchor?.startContainer.isConnected && this.ranges.length > 0) {
      const at = this.ranges.findIndex((range) => range.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0);
      this.index = at === -1 ? this.ranges.length - 1 : at;
    }
  }

  private watch(): void {
    if (this.observer) {
      return;
    }
    this.observer = new MutationObserver(() => {
      this.dirty = true;
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  private paint(): void {
    if (!CSS.highlights) {
      return;
    }
    CSS.highlights.set(ALL_MATCHES, new Highlight(...this.ranges));
    const current = this.ranges[this.index];
    if (current) {
      CSS.highlights.set(CURRENT_MATCH, new Highlight(current));
      current.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else {
      CSS.highlights.delete(CURRENT_MATCH);
    }
  }
}

function collectRanges(root: Node, text: string, matchCase: boolean): Range[] {
  const needle = matchCase ? text : text.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, noscript') || parent.getClientRects().length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const ranges: Range[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const haystack = matchCase ? node.data : node.data.toLowerCase();
    let from = 0;
    let at = haystack.indexOf(needle, from);
    while (at !== -1) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      from = at + needle.length;
      at = haystack.indexOf(needle, from);
    }
  }
  return ranges;
}
