import { terminalWorkspace } from '../../dist/src/terminal/workspace.js'
import { appendFileSync } from 'node:fs'
const trace = value => appendFileSync(process.env.ROOM_TEST_TRACE, JSON.stringify(value) + '\n')
function factory(member) {
 return options => {
  let resolve, timer
  return {
   initialize: async()=>{trace({type:'initialize',member,resume:options.resumeThreadId});return {threadId:options.resumeThreadId ?? member,model:'first-model'}},
   choices:async name=>name==='model'?[{value:'first-model',label:'First model',description:'',current:true},{value:'second-model',label:'Second model',description:''}]:[{value:'low',label:'low',description:''},{value:'high',label:'high',description:''}],
   command:async(name,arg)=>{trace({type:'command',member,name,arg});if(name==='model')options.onTelemetry?.({model:arg});if(name==='effort')options.onTelemetry?.({effort:arg});return '设置已应用'},
   run:async text=>{trace({type:'run',member,text}); options.onEvent?.({type:'text',text:`TURN_STARTED_${member}\n`});options.onEvent?.({type:'tool',text:'Read',tool:{id:member,name:'Read',input:{file_path:'fixture.txt'},status:'running'}});return await new Promise(r=>{resolve=r;timer=setTimeout(()=>{options.onEvent?.({type:'tool',text:'',tool:{id:member,name:'',output:Array.from({length:60},(_,i)=>`output-${i}`).join('\n'),status:'completed'}});r({status:'completed',text:'DONE_'+member})},1200)})},
   cancel:async()=>{trace({type:'cancel',member});clearTimeout(timer);resolve?.({status:'cancelled',text:''})},
   close:async()=>{clearTimeout(timer);resolve?.({status:'cancelled',text:''})},
  }
 }
}
await terminalWorkspace({codex:factory('codex'),claude:factory('claude')})
console.log('TUI_EXITED')
