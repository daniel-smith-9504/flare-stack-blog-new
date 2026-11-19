import { SettingsLead } from "@/features/config/components/admin/settings-lead";
import { m } from "@/paraglide/messages";
import { CacheMaintenance } from "@/features/cache/components/cache-maintenance";
import { SearchMaintenance } from "@/features/search/components/search-maintenance";

/** The Maintenance actions as tiles, two to a row; what cannot be undone says so. */
export function MaintenanceSection() {
  return (
    <div className="settings-maintenance-list">
      <SettingsLead
        description={`${m.settings_design_maintenance_hint()}${m.settings_design_immediate()}`}
      />
      <div className="settings-maintenance-grid">
        <SearchMaintenance />
        <CacheMaintenance />
      </div>
    </div>
  );
}
