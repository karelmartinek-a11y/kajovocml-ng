#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/limits.h>
#include <openssl/evp.h>
#include <sched.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static void fail(const char *message) { fprintf(stderr, "kcml-sandbox-launcher: %s: %s\n", message, strerror(errno)); exit(70); }
static const char *argument(int argc, char **argv, const char *name) { for (int i=1;i+1<argc;i++) if(strcmp(argv[i],name)==0) return argv[i+1]; return NULL; }
static int separator(int argc, char **argv) { for(int i=1;i<argc;i++) if(strcmp(argv[i],"--")==0) return i; return -1; }
static bool contained(const char *root, const char *path) { size_t length=strlen(root); return strncmp(root,path,length)==0 && (path[length]=='/' || path[length]=='\0'); }

static void file_sha256(int fd, char output[65]) {
  EVP_MD_CTX *context=EVP_MD_CTX_new(); if(!context) fail("EVP_MD_CTX_new");
  if(EVP_DigestInit_ex(context,EVP_sha256(),NULL)!=1) fail("EVP_DigestInit");
  unsigned char buffer[65536]; ssize_t size; if(lseek(fd,0,SEEK_SET)<0) fail("lseek");
  while((size=read(fd,buffer,sizeof(buffer)))>0) if(EVP_DigestUpdate(context,buffer,(size_t)size)!=1) fail("EVP_DigestUpdate");
  if(size<0) fail("read executable");
  unsigned char digest[EVP_MAX_MD_SIZE]; unsigned int length=0;
  if(EVP_DigestFinal_ex(context,digest,&length)!=1 || length!=32) fail("EVP_DigestFinal");
  EVP_MD_CTX_free(context);
  for(unsigned int i=0;i<length;i++) sprintf(output+i*2,"%02x",digest[i]);
  output[64]='\0';
}

int main(int argc, char **argv) {
  const char *uid_text=argument(argc,argv,"--uid"), *gid_text=argument(argc,argv,"--gid"), *release_input=argument(argc,argv,"--release-root"), *work_input=argument(argc,argv,"--workspace-root"), *expected_input=argument(argc,argv,"--executable-digest");
  int split=separator(argc,argv); if(!uid_text||!gid_text||!release_input||!work_input||!expected_input||split<0||split+1>=argc){fputs("invalid arguments\n",stderr);return 64;}
  uid_t uid=(uid_t)strtoul(uid_text,NULL,10); gid_t gid=(gid_t)strtoul(gid_text,NULL,10); char release[PATH_MAX],work[PATH_MAX],executable[PATH_MAX];
  if(!realpath(release_input,release)||!realpath(work_input,work)||!realpath(argv[split+1],executable)) fail("realpath");
  if(!contained(release,executable)){fputs("executable escapes release\n",stderr);return 65;}
  int executable_fd=open(executable,O_RDONLY|O_CLOEXEC|O_NOFOLLOW);if(executable_fd<0)fail("open executable");struct stat status;if(fstat(executable_fd,&status)!=0||!S_ISREG(status.st_mode)){fputs("executable is not regular\n",stderr);return 66;}
  char actual[65];file_sha256(executable_fd,actual);const char *expected=strncmp(expected_input,"sha256:",7)==0?expected_input+7:expected_input;if(strlen(expected)!=64||strcmp(actual,expected)!=0){fputs("executable digest mismatch\n",stderr);return 67;}
  if(prctl(PR_SET_PDEATHSIG,SIGKILL)!=0||prctl(PR_SET_DUMPABLE,0)!=0)fail("prctl identity");
  if(unshare(CLONE_NEWNS|CLONE_NEWIPC|CLONE_NEWUTS|CLONE_NEWNET)!=0)fail("unshare");
  if(mount(NULL,"/",NULL,MS_REC|MS_PRIVATE,NULL)!=0)fail("private mounts");
  if(mount(release,release,NULL,MS_BIND|MS_REC,NULL)!=0)fail("bind release");
  if(mount(NULL,release,NULL,MS_BIND|MS_REMOUNT|MS_RDONLY|MS_NODEV|MS_NOSUID,NULL)!=0)fail("readonly release");
  if(chdir(work)!=0)fail("chdir work");
  struct rlimit processes={64,64},files={1024,1024},core={0,0},size={1024ULL*1024ULL*1024ULL,1024ULL*1024ULL*1024ULL};
  setrlimit(RLIMIT_NPROC,&processes);setrlimit(RLIMIT_NOFILE,&files);setrlimit(RLIMIT_CORE,&core);setrlimit(RLIMIT_FSIZE,&size);
  if(setgroups(0,NULL)!=0||setgid(gid)!=0||setuid(uid)!=0)fail("drop identity");
  if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)!=0)fail("no_new_privs");
  const char *execution=getenv("KCML_EXECUTION_ID");clearenv();setenv("LANG","C.UTF-8",1);setenv("PATH","/usr/bin:/bin",1);if(execution)setenv("KCML_EXECUTION_ID",execution,1);
  char **child=&argv[split+1];fexecve(executable_fd,child,environ);fail("fexecve");return 70;
}
