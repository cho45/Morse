#!/usr/bin/env node
// VOICEVOX ENGINE OSS 時報用音声生成スクリプト
// usage:
//   node generate.js query   # クエリ生成・保存
//   node generate.js synth [並列数]  # 一括合成（デフォルト4並列）
//   node generate.js list-speakers   # speaker一覧表示

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = process.env.VOICEVOX_API_BASE || 'http://localhost:50021';
const SPEAKER = Number(process.env.VOICEVOX_SPEAKER || 1); // 適宜変更
const QUERY_FILE = path.join(__dirname, 'jiho_queries.json');
const OUTPUT_DIR = path.join(__dirname, 'jiho_audio');

const FIXED_PHRASES = [
	'正午をお知らせします',
	'をお知らせします',
	// 必要に応じて追加
];

const OVERRIDE_PARAMETERS = {
	speedScale: 0.8,
};

function makeHourText(hour) {
	const text = {
		0: 'れいじ',
		1: 'いちじ',
		2: 'にじ',
		3: 'さん時',
		4: 'よん時',
		5: 'ご時',
		6: 'ろく時',
		7: 'なな時',
		8: 'はち時',
		9: 'く時',
		10: 'じゅうじ',
		11: 'じゅういちじ',
		12: 'じゅうにじ',
		13: 'じゅうさん時',
		14: 'じゅうよん時',
		15: 'じゅうご時',
		16: 'じゅうろく時',
		17: 'じゅうなな時',
		18: 'じゅうはち時',
		19: 'じゅうく時',
		20: 'にじゅう時',
		21: 'にじゅういちじ',
		22: 'にじゅうにじ',
		23: 'にじゅうさん時',
	}[hour];
	if (text) return text;
	return `${hour}時`;
}
function makeMinuteText(minute) {
	const text = {
		0: 'れいふん',
	}[minute];
	if (text) return text;
	return `${minute}ふん`;
}
function makeSecondText(second) {
	if (second % 10 !== 0) return null;
	if (second === 0) return 'ちょうど';
	return `${second}びょう`;
}

function parseArgs() {
	const args = process.argv.slice(2);
	const mode = args[0];
	const parallel = Number(args[1]) || 4;
	return { mode, parallel };
}

async function fetchAudioQuery(text) {
	const params = new URLSearchParams({ text, speaker: String(SPEAKER) });
	const res = await fetch(`${API_BASE}/audio_query?${params.toString()}`, {
		method: 'POST',
	});
	if (!res.ok) throw new Error(`audio_query failed: ${text}`);
	return await res.json();
}

function sanitizeFilename(text) {
	return text.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
}

async function fetchSynthesis(query, text) {
	const params = new URLSearchParams({ speaker: String(SPEAKER) });
	const res = await fetch(`${API_BASE}/synthesis?${params.toString()}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			...query,
			...OVERRIDE_PARAMETERS
		}),
	});
	if (!res.ok) throw new Error(`synthesis failed: ${text}`);
	return await res.arrayBuffer();
}

async function synthesizeAll(parallel) {
	if (!fs.existsSync(QUERY_FILE)) {
		console.error('クエリファイルがありません。先に query モードで生成してください');
		process.exit(1);
	}
	if (!fs.existsSync(OUTPUT_DIR)) {
		fs.mkdirSync(OUTPUT_DIR);
	}
	const queries = JSON.parse(fs.readFileSync(QUERY_FILE));
	let idx = 0;
	async function worker() {
		while (true) {
			const i = idx++;
			if (i >= queries.length) break;
			const q = queries[i];
			let filename = sanitizeFilename(q.text) || `audio_${i}`;
			if (q.type === 'hour') {
				filename = `hour_${q.hour}`;
			} else if (q.type === 'minute') {
				filename = `minute_${q.minute}`;
			} else if (q.type === 'phrase') {
				filename = `phrase_${filename}`;
			} else if (q.type === 'second') {
				filename = `second_${q.second}`;
			}
			const outPath = path.join(OUTPUT_DIR, filename + '.wav');
			if (fs.existsSync(outPath)) {
				console.log(`Skip: ${outPath}`);
				continue;
			}
			try {
				const audio = await fetchSynthesis(q.query, q.text);
				fs.writeFileSync(outPath, Buffer.from(audio));
				console.log(`Saved: ${outPath}`);
			} catch (e) {
				console.error(`Error: ${q.text}`, e);
			}
		}
	}
	await Promise.all(Array.from({ length: parallel }, worker));
	console.log('全ファイルの合成が完了しました');
}

async function generateQueries() {
	const queries = [];
	// 時
	for (let hour = 0; hour < 24; hour++) {
		const text = makeHourText(hour);
		const query = await fetchAudioQuery(text);
		queries.push({ type: 'hour', hour, text, query });
		console.log(`Generated: ${text}`);
	}
	// 分
	for (let minute = 0; minute < 60; minute++) {
		const text = makeMinuteText(minute);
		const query = await fetchAudioQuery(text);
		queries.push({ type: 'minute', minute, text, query });
		console.log(`Generated: ${text}`);
	}
	for (let second = 0; second < 60; second += 10) {
		const text = makeSecondText(second);
		if (text) {
			const query = await fetchAudioQuery(text);
			queries.push({ type: 'second', second, text, query });
			console.log(`Generated: ${text}`);
		}
	}
	// 固定文言
	for (const phrase of FIXED_PHRASES) {
		const query = await fetchAudioQuery(phrase);
		queries.push({ type: 'phrase', text: phrase, query });
		console.log(`Generated: ${phrase}`);
	}
	fs.writeFileSync(QUERY_FILE, JSON.stringify(queries, null, 2));
	console.log(`Saved queries to ${QUERY_FILE}`);
}

async function listSpeakers() {
	const res = await fetch(`${API_BASE}/speakers`);
	if (!res.ok) throw new Error('speakers取得失敗');
	const speakers = await res.json();
	for (const sp of speakers) {
		console.log(`ID: ${sp.styles.map(s => s.id).join(', ')}\tNAME: ${sp.name}`);
	}
}

(async () => {
	const { mode, parallel } = parseArgs();
	if (mode === 'query') {
		await generateQueries();
	} else if (mode === 'synth') {
		await synthesizeAll(parallel);
	} else if (mode === 'list-speakers') {
		await listSpeakers();
	} else {
		console.log('usage: node generate.js [query|synth|list-speakers] [並列数]');
		process.exit(1);
	}
})();
