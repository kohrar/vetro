'use strict';
// Read only config.xml from a bounded WGT ZIP. No extraction or shell parsing.
var fs = require('fs');
var zlib = require('zlib');
var MAX_WGT = 32 * 1024 * 1024;
var MAX_CONFIG = 65536;
function crc32(data) {
    var crc = 0xffffffff;
    for (var i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function manifestId(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('unsupported XML declarations');
    xml = xml.replace(/<!--[\s\S]*?-->/g, '');
    var namespaces = {};
    var re = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])(.*?)\2/g, match;
    while ((match = re.exec(xml))) namespaces[match[1]] = match[3];
    var applications = [], tags = /<([A-Za-z_][\w.-]*):application\b([^<>]*)>/g;
    while ((match = tags.exec(xml))) {
        if (namespaces[match[1]] !== 'http://tizen.org/ns/widgets') continue;
        var attrs = match[2], id = /(?:^|\s)package\s*=\s*(["'])(.*?)\1/g;
        var value = id.exec(attrs);
        if (!value || id.exec(attrs) || !/^[A-Za-z0-9_.-]{1,128}$/.test(value[2])) throw new Error('invalid package ID');
        applications.push(value[2]);
    }
    if (applications.length !== 1) throw new Error('expected one Tizen application in config.xml');
    return applications[0];
}
function inflate(data, maxBytes) {
    maxBytes = maxBytes || MAX_CONFIG;
    return new Promise(function (resolve, reject) {
        var stream = zlib.createInflateRaw(), chunks = [], size = 0, settled = false;
        function fail(error) {
            if (settled) return;
            settled = true; chunks = []; stream.destroy(); reject(error);
        }
        stream.on('error', fail);
        stream.on('data', function (chunk) {
            size += chunk.length;
            if (size > maxBytes) return fail(new Error('config.xml too large'));
            chunks.push(chunk);
        });
        stream.on('end', function () {
            if (!settled) { settled = true; resolve(Buffer.concat(chunks)); }
        });
        stream.end(data);
    });
}
async function fromBuffer(zip, options) {
    if (zip.length < 22 || zip.length > MAX_WGT) throw new Error('invalid WGT size');
    var end = -1;
    for (var at = zip.length - 22; at >= Math.max(0, zip.length - 65557); at--) {
        if (zip.readUInt32LE(at) === 0x06054b50 && at + 22 + zip.readUInt16LE(at + 20) === zip.length) { end = at; break; }
    }
    if (end < 0 || zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6)) throw new Error('unsupported WGT ZIP');
    var count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), offset = zip.readUInt32LE(end + 16);
    if (!count || count > 4096 || zip.readUInt16LE(end + 8) !== count || size > 1048576 || offset + size !== end) throw new Error('invalid ZIP directory');
    var config, names = Object.create(null), files = Object.create(null), total = 0;
    for (var i = 0, pos = offset; i < count; i++) {
        if (pos + 46 > end || zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('invalid ZIP entry');
        var nameLen = zip.readUInt16LE(pos + 28), extra = zip.readUInt16LE(pos + 30), comment = zip.readUInt16LE(pos + 32);
        var next = pos + 46 + nameLen + extra + comment;
        if (next > end) throw new Error('truncated ZIP directory');
        var name = zip.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
        if (names[name] || name[0] === '/' || name.split('/').indexOf('..') !== -1) throw new Error('duplicate or unsafe ZIP entry');
        names[name] = true;
        if (name === 'config.xml' || options && options.includeFiles) {
            if (name === 'config.xml' && config) throw new Error('duplicate config.xml');
            var flags = zip.readUInt16LE(pos + 8), method = zip.readUInt16LE(pos + 10);
            var compressed = zip.readUInt32LE(pos + 20), unpacked = zip.readUInt32LE(pos + 24), local = zip.readUInt32LE(pos + 42);
            var limit = name === 'config.xml' ? MAX_CONFIG : MAX_WGT;
            total += unpacked;
            if (total > 64 * 1024 * 1024 || (flags & 1) || (method !== 0 && method !== 8) || compressed > (name === 'config.xml' ? 262144 : MAX_WGT) || unpacked > limit) throw new Error('unsupported config.xml encoding or size');
            if (local + 30 > offset || zip.readUInt32LE(local) !== 0x04034b50) throw new Error('invalid config.xml header');
            var localNameLen = zip.readUInt16LE(local + 26), start = local + 30 + localNameLen + zip.readUInt16LE(local + 28);
            if (start + compressed > offset || zip.slice(local + 30, local + 30 + localNameLen).toString('utf8') !== name || zip.readUInt16LE(local + 8) !== method) throw new Error('invalid config.xml location');
            var data = zip.slice(start, start + compressed);
            var decoded = method === 8 ? await inflate(data, limit) : data;
            if (decoded.length !== unpacked || crc32(decoded) !== zip.readUInt32LE(pos + 16)) throw new Error('config.xml checksum or size mismatch');
            if (name === 'config.xml') config = decoded.toString('utf8');
            if (options && options.includeFiles) files[name] = decoded;
        }
        pos = next;
    }
    if (pos !== end || config == null) throw new Error('missing or invalid config.xml');
    config = config.replace(/<!--[\s\S]*?-->/g, '');
    var packageId = manifestId(config);
    var widget = /<widget\b([^>]*)>/.exec(config), version = widget && /\bversion\s*=\s*(["'])([0-9]+\.[0-9]+\.[0-9]+)\1/.exec(widget[1]);
    var signed = !!(names['author-signature.xml'] && names['signature1.xml']);
    if (options && options.requireSigned && (!signed || !version)) throw new Error('Upload a signed WGT with author and distributor signatures and a valid version');
    var label = /<name(?:\s[^>]*)?>([^<]{1,200})<\/name>/.exec(config);
    return {files: options && options.includeFiles ? files : undefined, packageId: packageId, version: version ? version[2] : null, name: label ? label[1] : packageId, signed: signed};
}
async function read(wgtPath) {
    if (typeof wgtPath !== 'string' || !/^\/[A-Za-z0-9_./-]+\.wgt$/.test(wgtPath)) throw new Error('expected an absolute .wgt path without spaces or shell characters');
    var file = await fs.promises.open(wgtPath, 'r');
    try {
        var stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_WGT) throw new Error('invalid WGT file or size');
        // Read a fixed size to avoid an unbounded read if the file grows.
        var data = Buffer.alloc(stat.size);
        var at = 0;
        while (at < data.length) {
            var result = await file.read(data, at, data.length - at, at);
            if (!result.bytesRead) throw new Error('truncated WGT file');
            at += result.bytesRead;
        }
        return await fromBuffer(data);
    } finally { await file.close(); }
}
module.exports = {read: read, fromBuffer: fromBuffer, manifestId: manifestId, crc32: crc32, MAX_WGT: MAX_WGT};
