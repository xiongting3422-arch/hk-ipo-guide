import { useState, type ReactNode } from 'react';
import { DASHBOARD_PANELS, type DashboardPanelId } from '../constants';

export interface DashboardPanelConfig {
  id: DashboardPanelId;
  step: string;
  label: string;
  navLabel: string;
  icon: string;
  subtitle: string;
}

interface Props {
  panels: DashboardPanelConfig[];
  renderPanel: (id: DashboardPanelId) => ReactNode;
  resolveSubtitle?: (id: DashboardPanelId) => string;
}

export function DashboardShell({ panels, renderPanel, resolveSubtitle }: Props) {
  const [activeId, setActiveId] = useState<DashboardPanelId>(panels[0]?.id ?? 'overview');
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  const subtitle = resolveSubtitle?.(active.id) ?? active.subtitle;

  return (
    <div className="isd-shell">
      <nav className="isd-nav" aria-label="舆情看板模块">
        {panels.map((panel) => {
          const isActive = panel.id === activeId;
          return (
            <button
              key={panel.id}
              type="button"
              className={`isd-nav-item${isActive ? ' isd-nav-item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setActiveId(panel.id)}
            >
              {panel.navLabel}
            </button>
          );
        })}
      </nav>

      <div className="isd-main-panel">
        <header className="isd-panel-head">
          <div className="isd-panel-head-main">
            <span className="isd-panel-step">{active.step}</span>
            <div className="isd-panel-head-text">
              <h2 className="isd-panel-title">{active.label}</h2>
              {subtitle ? <p className="isd-panel-sub">{subtitle}</p> : null}
            </div>
          </div>
        </header>
        <div className="isd-panel-body">{renderPanel(active.id)}</div>
      </div>
    </div>
  );
}
