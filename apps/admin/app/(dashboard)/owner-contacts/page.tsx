import { listPropertyOwnerContacts } from "@workspace/core/owner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Owner contacts" };

export default async function OwnerContactsPage() {
	const contacts = await listPropertyOwnerContacts();

	return (
		<div className="mx-auto max-w-6xl">
			<div>
				<h1 className="font-display font-semibold text-xl tracking-tight">
					Owner contacts
				</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Property owners who have asked to discuss working with Alojamento
					Ideal.
					<span className="ml-1">{contacts.length} shown</span>
				</p>
			</div>

			<div className="mt-6 overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Contact</TableHead>
							<TableHead>Property</TableHead>
							<TableHead>Scale</TableHead>
							<TableHead>Received</TableHead>
							<TableHead>Notification</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{contacts.length === 0 ? (
							<TableRow>
								<TableCell
									className="py-12 text-center text-muted-foreground"
									colSpan={5}
								>
									No owner enquiries yet.
								</TableCell>
							</TableRow>
						) : (
							contacts.map((contact) => (
								<TableRow key={contact.id}>
									<TableCell className="min-w-52 align-top">
										<p className="font-medium">{contact.fullName}</p>
										<Link
											className="text-muted-foreground text-sm hover:text-foreground"
											href={`mailto:${contact.email}`}
										>
											{contact.email}
										</Link>
										<p className="mt-1 text-muted-foreground text-sm">
											{contact.phoneNumber}
										</p>
									</TableCell>
									<TableCell className="min-w-64 align-top">
										<p>{contact.propertyLocation}</p>
										<p className="mt-1 text-muted-foreground text-sm">
											{contact.propertyAddress}
										</p>
									</TableCell>
									<TableCell className="whitespace-nowrap align-top text-muted-foreground text-sm">
										{contact.propertyCount}{" "}
										{contact.propertyCount === 1 ? "property" : "properties"}
										<br />
										{contact.bedroomCount}{" "}
										{contact.bedroomCount === 1 ? "bedroom" : "bedrooms"}
									</TableCell>
									<TableCell className="whitespace-nowrap align-top text-muted-foreground text-sm">
										{formatDateTime(contact.createdAt)}
									</TableCell>
									<TableCell className="align-top text-sm">
										{contact.notificationSentAt ? (
											<span className="text-emerald-600 dark:text-emerald-400">
												Sent
											</span>
										) : (
											<span className="text-amber-600 dark:text-amber-400">
												Needs attention
											</span>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
