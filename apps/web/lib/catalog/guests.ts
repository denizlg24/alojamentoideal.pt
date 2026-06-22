/**
 * Translates a guest selection into the minimum person capacity a listing must
 * advertise. Every adult and child counts as one occupant; infants (under 2) do
 * not count toward occupancy and are excluded here.
 */
export function capacityForGuests(adults: number, children: number): number {
	return Math.max(1, adults + children);
}
