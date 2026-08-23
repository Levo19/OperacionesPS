// RECONCILIADOR CON BACKOFF (2026-08-23): cada hora consultaba a NubeFact TODAS las filas abiertas
// (36 hoy) en secuencia, sosteniendo la conexión de la base durante el burst — presión innecesaria
// sobre la instancia (compute Small) que coincidió con el "fetch is aborted" del dueño a las 07:13.
// Fix: (1) columna nf_consultado_at; (2) solo se re-consulta lo no visto hace >4h ('pendiente'
// mantiene ritmo horario: es el caso urgente); (3) máximo 15 filas por corrida, las más antiguas
// primero. Mismo resultado de reconciliación, una fracción del trabajo por hora.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
await c.query('alter table comprobantes add column if not exists nf_consultado_at timestamptz');
let r=(await c.query("select pg_get_functiondef('public.reconciliar_comprobantes'::regproc) d")).rows[0].d;
const A="               and (creado_at at time zone 'America/Lima')::date >= (now() at time zone 'America/Lima')::date - p_dias";
chk('anchor where', r.includes(A));
if(!/nf_consultado_at/.test(r)){
  r=r.replace(A, A+"\n"+
"               -- BACKOFF: 'pendiente' se consulta cada hora (urgente); el resto cada 4h. Máx 15\n"+
"               -- por corrida (antiguas primero) → burst corto, sin ahogar la instancia.\n"+
"               and (nf_consultado_at is null or nf_consultado_at < now() - case when estado='pendiente' then interval '50 minutes' else interval '4 hours' end)\n"+
"             order by nf_consultado_at asc nulls first\n"+
"             limit 15");
  const B="    v_n := v_n + 1;";
  chk('anchor loop', r.includes(B));
  r=r.replace(B, B+"\n    update comprobantes set nf_consultado_at = now() where id = r.id;   -- marca ANTES: si la consulta falla, igual espera su turno siguiente");
  await c.query('CREATE OR REPLACE '+r.slice(r.indexOf('FUNCTION')));
}
const back=(await c.query("select pg_get_functiondef('public.reconciliar_comprobantes'::regproc) d")).rows[0].d;
chk('backoff + límite en el reconciliador', /nf_consultado_at/.test(back) && /limit 15/.test(back));
if(!pass){await c.query('rollback');process.exit(1);}
await c.query('commit');
// medición real: primera corrida (hasta 15 filas) y segunda (todas en backoff → ~0)
const t1=Date.now(); const r1=(await c.query('select reconciliar_comprobantes(60) d')).rows[0].d; const d1=Date.now()-t1;
const t2=Date.now(); const r2=(await c.query('select reconciliar_comprobantes(60) d')).rows[0].d; const d2=Date.now()-t2;
console.log('  corrida 1: '+JSON.stringify(r1)+' en '+(d1/1000).toFixed(1)+'s');
console.log('  corrida 2: '+JSON.stringify(r2)+' en '+(d2/1000).toFixed(1)+'s');
chk('el lote respeta el límite', Number(r1.revisados)<=15);
chk('la segunda corrida ya casi no trabaja (backoff)', Number(r2.revisados)<=Math.max(0,15-Number(r1.revisados))+1, {rev2:r2.revisados});
console.log('\n★ reconciliador con backoff — COMMIT verificado');
await c.end();
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{try{await c.end()}catch(_){}}
})();
