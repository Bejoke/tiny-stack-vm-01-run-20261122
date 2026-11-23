// Tiny stack VM — make.fun tiny-stack-vm-01, ISA v1. Plain JavaScript, Node 22, stdlib only.
// For every /input/<id>/ it runs program.bin on input.bin and writes /output/<id>/stdout.bin
// (the bytes the program wrote) and /output/<id>/exit.txt (its exit code, 0-255).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// Binary ops (pop two, push one): (a, b) => r. DIV/DIVU/MOD/MODU trap 4 on b = 0.
const F = {
  16:(a,b)=>(a+b)|0,17:(a,b)=>(a-b)|0,18:Math.imul,
  19:(a,b)=>{if(!b)throw 4;return(a/b)|0;},
  20:(a,b)=>{if(!b)throw 4;return a%b;},
  21:(a,b)=>{if(!b)throw 4;return((a>>>0)/(b>>>0))|0;},
  22:(a,b)=>{if(!b)throw 4;return((a>>>0)%(b>>>0))|0;},
  24:(a,b)=>a&b,25:(a,b)=>a|b,26:(a,b)=>a^b,
  28:(a,b)=>a<<(b&31),29:(a,b)=>a>>(b&31),30:(a,b)=>(a>>>(b&31))|0,
  32:(a,b)=>a===b?1:0,33:(a,b)=>a<b?1:0,34:(a,b)=>(a>>>0)<(b>>>0)?1:0,
};
// Run one program; a trap throws its exit code as a number, HALT/EXIT return.
function run(P,G){
  const S=new Int32Array(256),C=new Int32Array(64),M=new Int32Array(256),O=[];
  const L=P.length;
  let x=0,c=0,z=0,w=0,t=0;
  const D=(k)=>({out:Buffer.from(O),code:k});
  const ps=(v)=>{if(x>=256)throw 3;S[x++]=v;}; // push, trap 3 when full
  const s16=(i)=>{const v=P[i]|(P[i+1]<<8);return v>=32768?v-65536:v;};
  try{
    for(;;){
      if(t>=1000000)throw 10; // step limit
      if(z<0||z>=L)throw 9; // pc outside the program
      const q=P[z];
      const m=q===1?1:q===2?4:q>47&&q<52?2:0;
      if(z+1+m>L)throw 9; // immediate cut off by the end
      t++;
      let N=z+1+m;
      const f=F[q];
      if(f){if(x<2)throw 2;S[x-2]=f(S[x-2],S[x-1]);x--;z=N;continue;}
      switch(q){
        case 0:return D(0); // HALT
        case 1:{const b=P[z+1];ps(b<128?b:b-256);break;} // PUSH8, sign-extended
        case 2:ps(P[z+1]|(P[z+2]<<8)|(P[z+3]<<16)|(P[z+4]<<24));break; // PUSH32
        case 3:if(x<1)throw 2;x--;break; // POP
        case 4:if(x<1)throw 2;ps(S[x-1]);break; // DUP
        case 5:if(x<2)throw 2;[S[x-1],S[x-2]]=[S[x-2],S[x-1]];break; // SWAP
        case 6:if(x<2)throw 2;ps(S[x-2]);break; // OVER
        case 7:if(x<3)throw 2;[S[x-3],S[x-2],S[x-1]]=[S[x-2],S[x-1],S[x-3]];break; // ROT
        case 23:if(x<1)throw 2;S[x-1]=(-S[x-1])|0;break; // NEG, wraps
        case 27:if(x<1)throw 2;S[x-1]=~S[x-1];break; // NOT
        case 48:N=z+3+s16(z+1);break; // JMP
        case 49:if(x<1)throw 2;if(S[--x]===0)N=z+3+s16(z+1);break; // JZ
        case 50:if(x<1)throw 2;if(S[--x]!==0)N=z+3+s16(z+1);break; // JNZ
        case 51: // CALL: 64 return addresses held already traps 7
          if(c>=64)throw 7;
          C[c++]=z+3;N=P[z+1]|(P[z+2]<<8);
          break;
        case 52:if(c===0)throw 8;N=C[--c];break; // RET
        case 64: // LOAD: addr outside 0 to 255 traps 6
          if(x<1)throw 2;
          if(S[x-1]<0||S[x-1]>255)throw 6;
          S[x-1]=M[S[x-1]];
          break;
        case 65: // STORE ( v addr -- ): addr outside 0 to 255 traps 6
          if(x<2)throw 2;
          if(S[x-1]<0||S[x-1]>255)throw 6;
          M[S[x-1]]=S[x-2];x-=2;
          break;
        case 80: // PRINT: v in decimal ASCII, no newline
          if(x<1)throw 2;
          {const v=S[--x];const s=String(v);
          if(O.length+s.length>65536)throw 11;
          for(let i=0;i<s.length;i++)O.push(s.charCodeAt(i));}
          break;
        case 81: // PUTC: one byte, v AND 255
          if(x<1)throw 2;
          if(O.length>=65536)throw 11;
          O.push(S[--x]&255);
          break;
        case 82:ps(w<G.length?G[w++]:-1);break; // IN: -1 once the input is used up
        case 83:if(x<1)throw 2;return D(S[--x]&255); // EXIT: code v AND 255
        default:throw 5; // unknown opcode (its immediate length is 0, so trap 9 cannot fire first)
      }
      z=N;
    }
  }catch(e){
    if(typeof e!=='number')throw e;
    return D(e); // a trap ends the program at once, keeping earlier output
  }
}
for(const id of readdirSync(I).sort()){
  const r=run(readFileSync(join(I,id,'program.bin')),readFileSync(join(I,id,'input.bin')));
  mkdirSync(join(O,id),{recursive:true});
  writeFileSync(join(O,id,'stdout.bin'),r.out);
  writeFileSync(join(O,id,'exit.txt'),r.code+'\n');
}
