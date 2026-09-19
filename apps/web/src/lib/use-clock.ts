import { useEffect, useState } from 'react';

export function useClock(active: boolean): number {
	const timeState = useState(() => Date.now());
	const now = timeState[0];
	const setNow = timeState[1];

	useEffect(() => {
		if (!active) return;
		const interval = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(interval);
	}, [active]);

	return now;
}
