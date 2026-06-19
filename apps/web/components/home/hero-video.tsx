"use client";

import { cn } from "@workspace/ui/lib/utils";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import videoFallback from "@/public/river2-poster.jpg";

export function HeroVideo() {
	const [loaded, setLoaded] = useState(false);
	const ref = useRef<HTMLVideoElement | null>(null);

	useEffect(() => {
		const video = ref.current;
		if (!video) return;

		if (video.readyState >= 3) {
			setLoaded(true);
			return;
		}

		const handleCanPlay = () => setLoaded(true);
		video.addEventListener("canplay", handleCanPlay);
		return () => video.removeEventListener("canplay", handleCanPlay);
	}, []);

	return (
		<div className="absolute inset-0 -z-10 overflow-hidden bg-neutral-900">
			{!loaded && (
				<Image
					src={videoFallback}
					alt=""
					aria-hidden
					priority
					unoptimized
					className="h-full w-full object-cover"
				/>
			)}
			<video
				ref={ref}
				src="/river2.mp4"
				poster={videoFallback.src}
				className={cn("h-full w-full object-cover", !loaded && "invisible")}
				autoPlay
				loop
				muted
				playsInline
				preload="auto"
			/>
			<div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />
		</div>
	);
}
