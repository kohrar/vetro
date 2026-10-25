'use strict';
var fs=require('fs'),path=require('path'),crypto=require('crypto'),info=require('./package-info.js');
function fingerprint(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Unsupported signature XML');
    var m=/<(?:[\w.-]+:)?X509Certificate\b[^>]*>([A-Za-z0-9+/=\s]+)<\/(?:[\w.-]+:)?X509Certificate>/.exec(xml);
    if(!m)throw Error('Author certificate missing');
    var der=Buffer.from(m[1].replace(/\s/g,''),'base64');
    crypto.createPublicKey('-----BEGIN CERTIFICATE-----\n'+der.toString('base64')+'\n-----END CERTIFICATE-----');
    return crypto.createHash('sha256').update(der).digest('hex');
}
function newer(a,b){var x=a.split('.').map(Number),y=b.split('.').map(Number);for(var i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function SelfUpdate(options){
    this.options=options;
    this.root=options.root||path.resolve(__dirname,'..');
    this.file=options.checkpoint||'/home/owner/share/vetro/self-update.json';
    this.version=options.version||require('./build-info.js').version;
    this.instance=crypto.randomBytes(16).toString('hex');
    this.record=null;this.timer=null;this.checking=false;
}
SelfUpdate.prototype.inspect=async function(buffer,metadata){
    if(!newer(metadata.version,this.version))throw Error('Vetro updates must have a newer version than '+this.version);
    var parsed=await info.fromBuffer(buffer,{requireSigned:true,includeFiles:true}),files=parsed.files;
    var author=fingerprint(fs.readFileSync(path.join(this.root,'author-signature.xml'),'utf8'));
    if(author!==fingerprint(files['author-signature.xml'].toString('utf8')))throw Error('Sign the update with the same author certificate as this Vetro installation');
    ['service/main.js','service/installer.js','service/self-update.js','service/build-info.js','service/platform.js','payload/SamsungTvRootAgent.dll','payload/SamsungTvArchiveRoot.dll'].forEach(function(n){if(!files[n])throw Error('Vetro TV integration is incomplete: '+n);});
    var build=/module\.exports\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(files['service/build-info.js'].toString('utf8'));
    if(!build)throw Error('Build the integration package with the Vetro builder before signing');
    // Treat uploaded JavaScript as data. Never execute it to inspect an update.
    var identity;
    try{identity=JSON.parse(build[1]);}catch(_){throw Error('Invalid Vetro build metadata');}
    if(identity.version!==metadata.version)throw Error('The package and Vetro build versions do not match');
    if(files['service/platform.js'].toString('utf8').indexOf('tv-integration')<0)throw Error('An app-only package cannot update the TV integration');
    var config=files['config.xml'].toString('utf8');
    if(!/\bid=["']vetrotvapp\.app["']/.test(config)||!/\bid=["']vetrotvapp\.svc["']/.test(config))throw Error('Vetro application/service identities do not match');
    var hashes={};
    Object.keys(files).forEach(function(n){
        if(n.endsWith('/')||/^(author-signature|signature\d+)\.xml$/.test(n))return;
        if(!/^[A-Za-z0-9_.\/-]+$/.test(n)||n.split('/').some(function(p){return !p||p==='.'||p==='..';}))throw Error('Unsupported update file path');
        hashes[n]=crypto.createHash('sha256').update(files[n]).digest('hex');
    });
    return Object.assign(metadata,{selfUpdate:true,currentVersion:this.version,author:author,hashes:hashes});
};
SelfUpdate.prototype.save=function(){
    var dir=path.dirname(this.file);fs.mkdirSync(dir,{recursive:true,mode:0o700});
    var temporary=this.file+'.'+this.instance+'.tmp',fd;
    try{
        fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(this.record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
        fs.renameSync(temporary,this.file);
        fd=fs.openSync(dir,'r');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temporary);}catch(_){} }
};
SelfUpdate.prototype.prepare=function(upload,job){
    this.record={schema:1,issuer:this.instance,author:upload.author,hashes:upload.hashes,deadline:Date.now()+180000,
        job:Object.assign({},job,{selfUpdate:true,state:'waiting_restart',submitted:null,message:'Updating Vetro. Waiting for the new service to start…'})};
    // Durable BEFORE calling the installer. Recovery never resubmits this command.
    this.save();return this.record.job;
};
SelfUpdate.prototype.recover=function(onJob){
    var self=this;
    if(this.checking)return;
    if(!this.record){
        try{
            var stat=fs.statSync(this.file);if(stat.size>1024*1024)throw Error('Update checkpoint too large');
            var r=JSON.parse(fs.readFileSync(this.file,'utf8'));
            if(r.schema!==1||!r.job||r.job.packageId!=='vetrotvapp'||!r.hashes||!Number.isFinite(r.deadline))throw Error('Invalid update checkpoint');
            this.record=r;
        }catch(e){if(e.code==='ENOENT')return;onJob({selfUpdate:true,state:'unverified',verified:false,message:'Update checkpoint could not be read. No installation was retried.'});return;}
    }
    var r=this.record,j=r.job;
    onJob(j);
    if(j.state==='verified'||j.state==='failed')return;
    if(this.instance===r.issuer||!this.options.available()){
        if(Date.now()>r.deadline){j.state='unverified';j.verified=false;j.message='Vetro restart or root connection was not confirmed. No update was retried. Restore Host PC IP to your computer and reinstall a known-good signed package if Vetro cannot start.';try{this.save();}catch(e){j.message+=' Checkpoint could not be saved.';}return;}
        clearTimeout(this.timer);this.timer=setTimeout(function(){self.recover(onJob);},2000);if(this.timer.unref)this.timer.unref();return;
    }
    this.checking=true;j.state='verifying';j.message='Vetro has restarted. Checking installed files and package version…';
    Promise.resolve().then(function(){
        if(j.version!==self.version)throw Error('The running Vetro version does not match the requested update');
        if(fingerprint(fs.readFileSync(path.join(self.root,'author-signature.xml'),'utf8'))!==r.author)throw Error('The running author certificate does not match the update');
        var root=fs.realpathSync(self.root);
        Object.keys(r.hashes).forEach(function(n){
            var target=path.resolve(root,n);
            if(!target.startsWith(root+path.sep)||!fs.realpathSync(target).startsWith(root+path.sep))throw Error('Invalid installed update path');
            if(crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==r.hashes[n])throw Error('Installed build does not match the uploaded package');
        });
        return self.options.inventory();
    }).then(function(d){
        var rows=d.apps.filter(function(a){return a.packageId==='vetrotvapp';});
        if(d.registryError||!rows.length||rows.some(function(a){return a.version!==j.version;}))throw Error('The native inventory does not confirm the requested Vetro version');
        j.state='verified';j.verified=true;j.finishedAt=Date.now();j.message='Vetro '+j.version+' restarted successfully. Installed files, author certificate and native package version match the update. Other TV features have not been tested.';
        self.save();
    }).catch(function(e){j.state='unverified';j.verified=false;j.message=e.message+'. No update was retried.';try{self.save();}catch(_){j.message+=' Checkpoint could not be saved.';}})
    .finally(function(){self.checking=false;onJob(j);});
};
module.exports={SelfUpdate:SelfUpdate,fingerprint:fingerprint,newer:newer};
