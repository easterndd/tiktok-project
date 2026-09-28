import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadMultipart, UploadRequestError } from '../src/upload-request.ts';

function fakeRequest() {
  const listeners = new Map();
  const uploadListeners = new Map();
  const headers = new Map();
  const xhr = {
    upload: { addEventListener: (name, callback) => uploadListeners.set(name, callback) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    open: (method, url) => { xhr.method = method; xhr.url = url; },
    setRequestHeader: (name, value) => headers.set(name, value),
    send: (body) => { xhr.body = body; },
    status: 0,
    responseText: ''
  };
  return { xhr, headers, emit: (name, event) => listeners.get(name)(event), emitUpload: (name, event) => uploadListeners.get(name)(event) };
}

test('reports actual transfer percent before the provider-processing phase', async () => {
  const fake = fakeRequest();
  const progress = [];
  const form = new FormData();
  const result = uploadMultipart('/upload', form, 'token', (value) => progress.push(value), () => fake.xhr);
  assert.equal(fake.xhr.method, 'POST');
  assert.equal(fake.xhr.body, form);
  assert.equal(fake.headers.get('Authorization'), 'Bearer token');
  assert.equal(fake.headers.has('Content-Type'), false);
  fake.emitUpload('progress', { lengthComputable: true, loaded: 25, total: 100 });
  fake.emitUpload('progress', { lengthComputable: false, loaded: 50, total: 100 });
  fake.emitUpload('load');
  fake.xhr.status = 200;
  fake.xhr.responseText = '{"job":{"status":"SUCCEEDED"}}';
  fake.emit('load');
  assert.deepEqual(progress, [{ phase: 'sending', percent: 25 }, { phase: 'processing' }]);
  assert.deepEqual(await result, { job: { status: 'SUCCEEDED' } });
});

test('preserves API error messages and HTTP status', async () => {
  const fake = fakeRequest();
  const result = uploadMultipart('/upload', new FormData(), null, () => {}, () => fake.xhr);
  fake.xhr.status = 409;
  fake.xhr.responseText = '{"error":{"message":"Already uploading"}}';
  fake.emit('load');
  await assert.rejects(result, (error) => error instanceof UploadRequestError && error.status === 409 && error.message === 'Already uploading');
});

test('reports network interruption without claiming the upload succeeded', async () => {
  const fake = fakeRequest();
  const result = uploadMultipart('/upload', new FormData(), null, () => {}, () => fake.xhr);
  fake.emit('error');
  await assert.rejects(result, (error) => error instanceof UploadRequestError && error.status === 0);
});

test('rejects an empty success response so the episode is not marked uploaded', async () => {
  const fake = fakeRequest();
  const result = uploadMultipart('/upload', new FormData(), null, () => {}, () => fake.xhr);
  fake.xhr.status = 200;
  fake.emit('load');
  await assert.rejects(result, (error) => error instanceof UploadRequestError && error.status === 200);
});
