export function reportCompanionDiagnostic(status:string){
  if(process.env.NODE_ENV!=="production")window.dispatchEvent(new CustomEvent("ariadne:companion-diagnostic",{detail:status}));
}
