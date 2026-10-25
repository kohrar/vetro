'use strict';
// One bounded upload and one installation at a time. Paths never come from clients.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var info = require('./package-info.js');
function Installer(options) {
    this.options = options;
    this.directory = options.directory || process.env.VETRO_UPLOAD_DIR || '/home/owner/share/tmp/sdk_tools/vetro-installs';
    this.upload = null;
    this.receiving = false;
    this.job = null;
    var self=this;
    this.selfUpdate = new (require('./self-update.js').SelfUpdate)({root:options.root, checkpoint:options.checkpoint, version:options.version, port:options.port,
        inventory:options.inventory, available:function(){return self.available();}});
}
Installer.prototype.recover = function () {
    var self=this;
    this.selfUpdate.recover(function(job){
        self.job=job;
        if(job.verified && /^[a-f0-9]{32}$/.test(job.id || '')) {
            try { fs.unlinkSync(path.join(self.directory,job.id+'.wgt')); } catch (_) {}
            self.upload=null;
        }
    });
};
Installer.prototype.available = function () {
    var s = this.options.status();
    return s.mode === 'tv-integration' && !!(s.agent && s.agent.connected);
};
Installer.prototype.busy = function () { return this.receiving || !!(this.job && /^(checking|installing|verifying|waiting_restart)$/.test(this.job.state)); };
Installer.prototype.clear = function () {
    if (this.upload) { try { fs.unlinkSync(this.upload.path); } catch (_) {} this.upload = null; }
};
Installer.prototype.snapshot = function () {
    if (this.upload && Date.now() > this.upload.expiresAt && !this.busy()) this.clear();
    var u = this.upload;
    return {available: this.available(), busy: this.busy(), maxBytes: info.MAX_WGT,
        upload: u ? {token:u.token, packageId:u.packageId, version:u.version, name:u.name, bytes:u.bytes, expiresAt:u.expiresAt, selfUpdate:!!u.selfUpdate, currentVersion:u.currentVersion} : null,
        job: this.job};
};
Installer.prototype.receive = function (req) {
    var self = this;
    if (this.busy() || this.options.isBusy()) return Promise.reject(Object.assign(Error('Another app operation is in progress'), {statusCode:409}));
    if (!this.available()) return Promise.reject(Object.assign(Error('Connect the root agent before uploading so installation can be verified'), {statusCode:503}));
    if ((req.headers['content-type'] || '').split(';')[0] !== 'application/octet-stream') return Promise.reject(Object.assign(Error('Expected a WGT file upload'), {statusCode:415}));
    if (Number(req.headers['content-length']) > info.MAX_WGT) return Promise.reject(Object.assign(Error('WGT must be 32 MiB or smaller'), {statusCode:413}));
    this.receiving = true;
    this.clear();
    this.job = null;
    var token = crypto.randomBytes(16).toString('hex'), file = path.join(this.directory, token + '.wgt');
    return new Promise(function (resolve, reject) {
        var fd, bytes = 0, settled = false;
        var timer = setTimeout(function () { finish(Error('Upload timed out')); }, 120000);
        function finish(error) {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} fd = undefined; }
            if (error) {
                try { fs.unlinkSync(file); } catch (_) {}
                self.receiving = false;
                if (req.resume) req.resume();
                return reject(error);
            }
            fs.promises.readFile(file).then(async function (data) {
                var metadata=await info.fromBuffer(data, {requireSigned:true});
                return metadata.packageId==='vetrotvapp' ? self.selfUpdate.inspect(data,metadata) : metadata;
            }).then(function (metadata) {
                self.upload = Object.assign(metadata, {token:token, path:file, bytes:bytes, expiresAt:Date.now()+15*60*1000});
                self.receiving = false; resolve(self.snapshot());
            }).catch(function (e) { try { fs.unlinkSync(file); } catch (_) {} self.receiving = false; reject(e); });
        }
        try {
            fs.mkdirSync(self.directory, {recursive:true, mode:0o700});
            // Remove expired uploads left by a previous service lifetime, only in our own namespace.
            fs.readdirSync(self.directory).filter(function (n) { return /^[a-f0-9]{32}\.wgt$/.test(n); }).forEach(function (n) {
                var stale=path.join(self.directory,n);
                try { if (Date.now()-fs.statSync(stale).mtimeMs>15*60*1000) fs.unlinkSync(stale); } catch (_) {}
            });
            fd = fs.openSync(file, 'wx', 0o600);
        }
        catch (e) { finish(e); return; }
        req.on('data', function (chunk) {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > info.MAX_WGT) return finish(Object.assign(Error('WGT must be 32 MiB or smaller'), {statusCode:413}));
            try {
                var offset=0;
                while(offset<chunk.length) offset+=fs.writeSync(fd,chunk,offset,chunk.length-offset);
            } catch (e) { finish(e); }
        });
        req.on('end', function () { finish(); });
        req.on('aborted', function () { finish(Error('Upload interrupted')); });
        req.on('error', function () { finish(Error('Upload failed')); });
    });
};
Installer.prototype.start = function (token, confirmSelfUpdate) {
    this.snapshot();
    if (this.busy() || this.options.isBusy()) throw Object.assign(Error('Another app operation is in progress'), {statusCode:409});
    if (!this.available()) throw Object.assign(Error('Root agent is disconnected; no installation sent'), {statusCode:503});
    var u = this.upload;
    if (!u || typeof token !== 'string' || token !== u.token) throw Object.assign(Error('Upload expired; choose the file again'), {statusCode:409});
    if (u.selfUpdate && confirmSelfUpdate !== true) throw Object.assign(Error('Confirm that you understand the restart and manual recovery instructions'), {statusCode:400});
    var selfSubmitted=false;
    var self = this, job = this.job = {id:u.token, name:u.name, packageId:u.packageId, version:u.version,
        state:'checking', verified:false, message:'Checking the installed version…', startedAt:Date.now()};
    // The HTTP response returns immediately. A browser disconnect never retries an install.
    this.completion = Promise.resolve().then(function () { return self.options.inventory(); }).then(function (before) {
        if (before.registryError) throw Error('Fresh TV inventory unavailable; no installation sent');
        job.previousVersion = (before.apps.find(function (a) { return a.packageId === u.packageId; }) || {}).version || null;
        if(u.selfUpdate){
            job=self.job=self.selfUpdate.prepare(u,job);
            selfSubmitted=true;
            self.recover();
        }else { job.state='installing'; job.message='Installing on the TV…'; job.submitted=null; }
        return self.options.install(u.packageId,u.path);
    }).then(function (output) {
        if(u.selfUpdate){job.message='Update submitted. Waiting for a new Vetro service to verify the build…';return null;}
        job.submitted=true;
        var text=String(output || '');
        if (!/install completed|successfully installed/i.test(text) || /install failed|installation failed/i.test(text)) {
            throw Error('TV installer did not confirm success. Check the installed apps before trying again');
        }
        job.state='verifying'; job.message='Checking the TV inventory for version '+u.version+'…';
        return self.verify(u, 3);
    }).then(function (rows) {
        if(u.selfUpdate)return;
        job.state='verified'; job.verified=true; job.message='Installed version '+u.version+' confirmed in the TV inventory. Opening the app has not been tested.';
        job.appIds=rows.map(function (a) { return a.appId; });
    }).catch(function (e) {
        if(selfSubmitted){job.message='Update connection ended. Waiting for Vetro to restart; no update will be retried automatically.';return;}
        job.state=job.submitted===undefined?'failed':'unverified';
        job.message=String(e.message || e);
    }).finally(function () { if(!selfSubmitted){job.finishedAt=Date.now(); self.clear();} });
    return this.snapshot();
};
Installer.prototype.verify = function (u, remaining) {
    var self=this;
    return this.options.inventory().then(function (d) {
        var rows=d.apps.filter(function (a) { return a.packageId===u.packageId; });
        if (!d.registryError && rows.length && rows.every(function (a) { return a.version===u.version; })) return rows;
        if (remaining>1) return new Promise(function (r) { setTimeout(r,1000); }).then(function () { return self.verify(u,remaining-1); });
        throw Error('Installation was submitted, but version '+u.version+' could not be confirmed in a fresh TV inventory. Check installed apps before retrying');
    });
};
module.exports = {Installer:Installer};
