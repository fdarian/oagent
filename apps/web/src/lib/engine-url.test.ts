import { describe, expect, test } from 'bun:test';
import {
	createEngineEndpointURL,
	resolveConfiguredEngineURL,
} from './engine-url.ts';

test('remembers the selected engine for legacy job URLs without an engine query', () => {
	const entries = new Map<string, string>();
	const storage = {
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
	};
	expect(resolveConfiguredEngineURL('', storage)).toBe('/rpc');
	expect(
		resolveConfiguredEngineURL(
			'?engine=http%3A%2F%2Flocalhost%3A17778',
			storage,
		),
	).toBe('http://localhost:17778');
	expect(resolveConfiguredEngineURL('', storage)).toBe(
		'http://localhost:17778',
	);
});

describe('engine endpoint URLs', () => {
	test('uses the same-origin RPC proxy by default', () => {
		const url = createEngineEndpointURL(
			'/rpc',
			'/jobs/job-1/events',
			'http://localhost:5173',
		);

		expect(url.toString()).toBe('http://localhost:5173/jobs/job-1/events');
	});

	test('uses an engine override for both RPC and SSE endpoints', () => {
		const rpcURL = createEngineEndpointURL(
			'https://engine.example.test:17777',
			'/rpc',
			'http://console.example.test',
		);
		const eventsURL = createEngineEndpointURL(
			'https://engine.example.test:17777/rpc?token=abc',
			'/jobs/job-1/events',
			'http://console.example.test',
		);

		expect(rpcURL.toString()).toBe('https://engine.example.test:17777/rpc');
		expect(eventsURL.toString()).toBe(
			'https://engine.example.test:17777/jobs/job-1/events?token=abc',
		);
	});
});
