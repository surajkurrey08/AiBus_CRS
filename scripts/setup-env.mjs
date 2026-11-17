import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
const target=new URL('../backend/.env',import.meta.url);
if(fs.existsSync(target)){console.log('backend/.env already exists; no values changed.')}else{const example=fs.readFileSync(new URL('../backend/.env.example',import.meta.url),'utf8');fs.writeFileSync(target,example.replace('replace-with-a-random-secret-of-at-least-48-characters',randomBytes(48).toString('base64url')),{mode:0o600,flag:'wx'});console.log('Created backend/.env with a random development JWT key. Configure MongoDB, Redis and bootstrap credentials before starting.');}
