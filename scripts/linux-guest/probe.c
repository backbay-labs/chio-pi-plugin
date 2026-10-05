#include <node_api.h>
#include <unistd.h>
#include <errno.h>
static napi_value probe(napi_env env, napi_callback_info info) {
  size_t n=4; napi_value values[4]; int64_t args[4]={0};
  napi_get_cb_info(env,info,&n,values,0,0);
  for(size_t i=0;i<n;i++) napi_get_value_int64(env,values[i],&args[i]);
  errno=0; long result=syscall(args[0],args[1],args[2],args[3],0,0,0);
  napi_value value; napi_create_int64(env,result==-1?-errno:result,&value); return value;
}
static napi_value init(napi_env env,napi_value exports) {
  napi_value fn; napi_create_function(env,"probe",5,probe,0,&fn);
  napi_set_named_property(env,exports,"probe",fn); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
