import { describe, expect, test } from 'bun:test';
import { createEngineEndpointURL } from './engine-url.ts';

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
