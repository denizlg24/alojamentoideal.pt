/**
 * Translates a guest selection into the minimum person capacity a listing must
 * advertise. Following Hostify's convention, two children count as one adult
 * for capacity purposes, so a family of two adults and two children needs a
 * listing that sleeps three.
 */
export function capacityForGuests(adults: number, children: number): number {
	return Math.max(1, adults + Math.ceil(children / 2));
}
