#include "../client/client.h"
#include "web_local.h"

#include <dirent.h>
#include <emscripten/emscripten.h>
#include <errno.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <sys/stat.h>
#include <unistd.h>

#define MAX_FOUND_FILES 0x1000
#define MASK_QUED_EVENTS (WEB_MAX_QUEUED_EVENTS - 1)

static char installPath[MAX_OSPATH] = "/data";
static char homePath[MAX_OSPATH] = "/persist";
static char cdPath[MAX_OSPATH] = "";
static sysEvent_t eventQueue[WEB_MAX_QUEUED_EVENTS];
static int eventHead;
static int eventTail;
static byte packetBuffer[MAX_MSGLEN];

static void Sys_In_Restart_f(void) {
	IN_Shutdown();
	IN_Init();
}

int Sys_Milliseconds(void) {
	static double base;
	double now = emscripten_get_now();
	if (!base) {
		base = now;
	}
	return (int)(now - base);
}

void Sys_SnapVector(float *v) {
	v[0] = nearbyintf(v[0]);
	v[1] = nearbyintf(v[1]);
	v[2] = nearbyintf(v[2]);
}

void Sys_Mkdir(const char *path) {
	if (mkdir(path, 0777) != 0 && errno != EEXIST) {
		Com_DPrintf("Sys_Mkdir(%s): %s\n", path, strerror(errno));
	}
}

char *strlwr(char *s) {
	char *p = s;
	while (p && *p) {
		*p = (char)tolower((unsigned char)*p);
		++p;
	}
	return s;
}

static void Sys_ListFilteredFiles(const char *basedir, const char *subdirs,
	char *filter, char **list, int *numfiles) {
	char search[MAX_OSPATH];
	char relative[MAX_OSPATH];
	char childSubdir[MAX_OSPATH];
	DIR *directory;
	struct dirent *entry;
	struct stat st;

	if (*numfiles >= MAX_FOUND_FILES - 1) {
		return;
	}
	Com_sprintf(search, sizeof(search), subdirs[0] ? "%s/%s" : "%s", basedir, subdirs);
	directory = opendir(search);
	if (!directory) {
		return;
	}
	while ((entry = readdir(directory)) != NULL && *numfiles < MAX_FOUND_FILES - 1) {
		if (!Q_stricmp(entry->d_name, ".") || !Q_stricmp(entry->d_name, "..")) {
			continue;
		}
		Com_sprintf(relative, sizeof(relative), subdirs[0] ? "%s/%s" : "%s",
			subdirs, entry->d_name);
		Com_sprintf(childSubdir, sizeof(childSubdir), "%s/%s", basedir, relative);
		if (stat(childSubdir, &st) != 0) {
			continue;
		}
		if (S_ISDIR(st.st_mode)) {
			Sys_ListFilteredFiles(basedir, relative, filter, list, numfiles);
		}
		if (Com_FilterPath(filter, relative, qfalse)) {
			list[(*numfiles)++] = CopyString(relative);
		}
	}
	closedir(directory);
}

char **Sys_ListFiles(const char *directory, const char *extension, char *filter,
	int *numfiles, qboolean wantsubs) {
	char *found[MAX_FOUND_FILES];
	char path[MAX_OSPATH];
	char **result;
	DIR *dir;
	struct dirent *entry;
	struct stat st;
	int count = 0;
	int i;
	int extensionLength;
	qboolean directoriesOnly = wantsubs;

	if (filter) {
		Sys_ListFilteredFiles(directory, "", filter, found, &count);
	} else {
		if (!extension) {
			extension = "";
		}
		if (extension[0] == '/' && extension[1] == '\0') {
			extension = "";
			directoriesOnly = qtrue;
		}
		extensionLength = (int)strlen(extension);
		dir = opendir(directory);
		if (dir) {
			while ((entry = readdir(dir)) != NULL && count < MAX_FOUND_FILES - 1) {
				if (!Q_stricmp(entry->d_name, ".") || !Q_stricmp(entry->d_name, "..")) {
					continue;
				}
				Com_sprintf(path, sizeof(path), "%s/%s", directory, entry->d_name);
				if (stat(path, &st) != 0 || (directoriesOnly != (qboolean)S_ISDIR(st.st_mode))) {
					continue;
				}
				if (extensionLength && ((int)strlen(entry->d_name) < extensionLength ||
					Q_stricmp(entry->d_name + strlen(entry->d_name) - extensionLength, extension))) {
					continue;
				}
				found[count++] = CopyString(entry->d_name);
			}
			closedir(dir);
		}
	}

	*numfiles = count;
	if (!count) {
		return NULL;
	}
	result = Z_Malloc((count + 1) * sizeof(*result));
	for (i = 0; i < count; ++i) {
		result[i] = found[i];
	}
	result[count] = NULL;
	return result;
}

void Sys_FreeFileList(char **list) {
	int i;
	if (!list) {
		return;
	}
	for (i = 0; list[i]; ++i) {
		Z_Free(list[i]);
	}
	Z_Free(list);
}

char *Sys_Cwd(void) {
	static char cwd[MAX_OSPATH];
	if (!getcwd(cwd, sizeof(cwd))) {
		Q_strncpyz(cwd, "/", sizeof(cwd));
	}
	return cwd;
}

void Sys_SetDefaultCDPath(const char *path) { Q_strncpyz(cdPath, path, sizeof(cdPath)); }
char *Sys_DefaultCDPath(void) { return cdPath; }
void Sys_SetDefaultInstallPath(const char *path) { Q_strncpyz(installPath, path, sizeof(installPath)); }
char *Sys_DefaultInstallPath(void) { return installPath; }
void Sys_SetDefaultHomePath(const char *path) { Q_strncpyz(homePath, path, sizeof(homePath)); }
char *Sys_DefaultHomePath(void) { return homePath; }

int Sys_GetProcessorId(void) { return CPUID_GENERIC; }
unsigned int Sys_ProcessorCount(void) { return 1; }
qboolean Sys_LowPhysicalMemory(void) { return qfalse; }
int Sys_MonkeyShouldBeSpanked(void) { return 0; }
char *Sys_GetCurrentUser(void) { return "browser-player"; }

void Sys_ShowConsole(int level, qboolean quitOnClose) { (void)level; (void)quitOnClose; }
void Sys_DisplaySystemConsole(qboolean show) { (void)show; }
void Sys_SetErrorText(const char *text) { (void)text; }
void Sys_BeginProfiling(void) {}
void Sys_EndProfiling(void) {}

void Sys_Init(void) {
	Cmd_AddCommand("in_restart", Sys_In_Restart_f);
	Cvar_Set("arch", "WebAssembly");
	Cvar_Set("username", Sys_GetCurrentUser());
	IN_Init();
}

void Sys_Print(const char *msg) { fputs(msg, stdout); }

void QDECL Sys_Error(const char *error, ...) {
	char message[4096];
	va_list args;
	va_start(args, error);
	vsnprintf(message, sizeof(message), error, args);
	va_end(args);
	fprintf(stderr, "[quake3-wasm] fatal: %s\n", message);
	emscripten_cancel_main_loop();
	abort();
}

void Sys_Quit(void) {
	CL_Shutdown();
	NET_Shutdown();
	emscripten_cancel_main_loop();
	exit(0);
}

char *Sys_GetClipboardData(void) { return NULL; }
qboolean Sys_CheckCD(void) { return qtrue; }

void *QDECL Sys_LoadDll(const char *name, char *fqpath,
	int (QDECL **entryPoint)(int, ...), int (QDECL *systemcalls)(int, ...)) {
	(void)name; (void)fqpath; (void)entryPoint; (void)systemcalls;
	return NULL;
}
void Sys_UnloadDll(void *dllHandle) { (void)dllHandle; }

void Sys_BeginStreamedFile(fileHandle_t f, int readahead) { (void)f; (void)readahead; }
void Sys_EndStreamedFile(fileHandle_t f) { (void)f; }
int Sys_StreamedRead(void *buffer, int size, int count, fileHandle_t f) {
	int bytes = FS_Read(buffer, size * count, f);
	return size > 0 ? bytes / size : 0;
}
void Sys_StreamSeek(fileHandle_t f, int offset, int origin) { FS_Seek(f, offset, origin); }

void Sys_QueEvent(int time, sysEventType_t type, int value, int value2,
	int ptrLength, void *ptr) {
	sysEvent_t *event = &eventQueue[eventHead & MASK_QUED_EVENTS];
	if (eventHead - eventTail >= WEB_MAX_QUEUED_EVENTS) {
		if (event->evPtr) {
			Z_Free(event->evPtr);
		}
		++eventTail;
	}
	++eventHead;
	event->evTime = time ? time : Sys_Milliseconds();
	event->evType = type;
	event->evValue = value;
	event->evValue2 = value2;
	event->evPtrLength = ptrLength;
	event->evPtr = ptr;
}

sysEvent_t Sys_GetEvent(void) {
	sysEvent_t event;
	msg_t message;
	netadr_t address;

	if (eventHead > eventTail) {
		return eventQueue[eventTail++ & MASK_QUED_EVENTS];
	}
	Sys_SendKeyEvents();
	IN_Frame();
	MSG_Init(&message, packetBuffer, sizeof(packetBuffer));
	if (Sys_GetPacket(&address, &message)) {
		int length = sizeof(address) + message.cursize;
		netadr_t *copy = Z_Malloc(length);
		*copy = address;
		memcpy(copy + 1, message.data, message.cursize);
		Sys_QueEvent(0, SE_PACKET, 0, 0, length, copy);
	}
	if (eventHead > eventTail) {
		return eventQueue[eventTail++ & MASK_QUED_EVENTS];
	}
	memset(&event, 0, sizeof(event));
	event.evTime = Sys_Milliseconds();
	return event;
}
