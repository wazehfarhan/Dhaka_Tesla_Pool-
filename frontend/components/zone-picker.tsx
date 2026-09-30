/**
 * `ZonePicker` (ui-ux §6) — two selects fed by `GET /zones`, blocking an identical
 * pickup/destination client-side ("we never send a request the API will reject
 * with SAME_ZONE just to show it a red box").
 *
 * The API re-validates; this only spares the user a pointless round trip.
 */

import { SelectField } from '@/components/ui';
import type { Zone } from '@/lib/types';

const PLACEHOLDER = 'Select a zone';

export function ZonePicker({
  zones,
  pickup,
  destination,
  onPickupChange,
  onDestinationChange,
  disabled = false,
}: {
  zones: Zone[];
  pickup: string;
  destination: string;
  onPickupChange: (zone: string) => void;
  onDestinationChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const sameZone = pickup !== '' && pickup === destination;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Pickup"
        name="pickupZone"
        value={pickup}
        disabled={disabled}
        onChange={(event) => onPickupChange(event.target.value)}
      >
        <option value="">{PLACEHOLDER}</option>
        {zones.map((zone) => (
          <option key={zone.id} value={zone.name} disabled={zone.name === destination}>
            {zone.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label="Destination"
        name="destinationZone"
        value={destination}
        disabled={disabled}
        onChange={(event) => onDestinationChange(event.target.value)}
      >
        <option value="">{PLACEHOLDER}</option>
        {zones.map((zone) => (
          <option key={zone.id} value={zone.name} disabled={zone.name === pickup}>
            {zone.name}
          </option>
        ))}
      </SelectField>

      {sameZone && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          Pickup and destination must be different zones.
        </p>
      )}
    </div>
  );
}
