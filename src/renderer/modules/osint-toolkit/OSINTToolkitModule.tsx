/**
 * OSINT Toolkit — a Win98 folder-style launcher window.
 *
 * Pure shell: reads the live module registry, groups it via buildOsintDirectory
 * (category:'osint' modules only, bucketed by subcategory), and renders one
 * clickable tile per tool. Clicking a tile opens that module's own window —
 * this module owns no OSINT logic of its own and makes no IPC calls.
 *
 * All rendered text (subcategory heading, glyph, title) comes from this app's
 * own built-in module registrations — not untrusted input — but is still
 * rendered as plain React text children (no dangerouslySetInnerHTML) as a
 * matter of course.
 */

import { listModules } from '../../state/registry';
import { useWindows } from '../../state/store';
import { buildOsintDirectory } from './directory';
import './osint-toolkit.css';

export function OSINTToolkitModule(): JSX.Element {
  const groups = buildOsintDirectory(listModules());

  function launch(key: string, title: string): void {
    useWindows.getState().open({ module: key, title });
  }

  if (groups.length === 0) {
    return (
      <div className="ot-root">
        <p className="ot-empty">No OSINT tools registered.</p>
      </div>
    );
  }

  return (
    <div className="ot-root">
      {groups.map((group) => (
        <div key={group.subcategory} className="ot-group">
          <div className="ot-group-heading">{group.subcategory}</div>
          <div className="ot-grid">
            {group.tools.map((tool) => (
              <button
                key={tool.key}
                type="button"
                className="ot-tile"
                onClick={() => launch(tool.key, tool.title)}
              >
                <span className="ot-tile-glyph" aria-hidden="true">{tool.glyph}</span>
                <span className="ot-tile-title">{tool.title}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
