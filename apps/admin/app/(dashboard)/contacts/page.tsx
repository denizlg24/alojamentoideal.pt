import { listContactMessages } from "@workspace/core/contact";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
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
import { markContactReadAction } from "./actions";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage() {
	const messages = await listContactMessages();

	return (
		<div className="mx-auto max-w-6xl">
			<div>
				<h1 className="font-display font-semibold text-xl tracking-tight">
					Contacts
				</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Messages sent through the contact form on the public help page.
					<span className="ml-1">{messages.length} shown</span>
				</p>
			</div>

			<div className="mt-6 overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Contact</TableHead>
							<TableHead>Message</TableHead>
							<TableHead>Received</TableHead>
							<TableHead>Notification</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{messages.length === 0 ? (
							<TableRow>
								<TableCell
									className="py-12 text-center text-muted-foreground"
									colSpan={5}
								>
									No contact messages yet.
								</TableCell>
							</TableRow>
						) : (
							messages.map((message) => (
								<TableRow
									className={message.readAt ? "text-muted-foreground" : ""}
									key={message.id}
								>
									<TableCell className="min-w-48 align-top">
										<p className="font-medium">{message.name}</p>
										<Link
											className="text-muted-foreground text-sm hover:text-foreground"
											href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`}
										>
											{message.email}
										</Link>
									</TableCell>
									<TableCell className="min-w-72 max-w-xl align-top">
										<p className="font-medium">{message.subject}</p>
										<p className="mt-1 whitespace-pre-wrap text-muted-foreground text-sm">
											{message.message}
										</p>
									</TableCell>
									<TableCell className="whitespace-nowrap align-top text-muted-foreground text-sm">
										{formatDateTime(message.createdAt)}
									</TableCell>
									<TableCell className="align-top text-sm">
										{message.notificationSentAt ? (
											<span className="text-emerald-600 dark:text-emerald-400">
												Sent
											</span>
										) : (
											<span className="text-amber-600 dark:text-amber-400">
												Needs attention
											</span>
										)}
									</TableCell>
									<TableCell className="align-top">
										{message.readAt ? (
											<Badge variant="secondary">Read</Badge>
										) : (
											<form action={markContactReadAction}>
												<input name="id" type="hidden" value={message.id} />
												<Button size="sm" type="submit" variant="outline">
													Mark as read
												</Button>
											</form>
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
