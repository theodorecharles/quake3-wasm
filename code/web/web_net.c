#include "../game/q_shared.h"
#include "../qcommon/qcommon.h"

void NET_Init(void) {
	Com_Printf("[quake3-wasm] remote networking disabled in first browser milestone\n");
}

void NET_Shutdown(void) {}
void NET_Sleep(int msec) { (void)msec; }

qboolean Sys_StringToAdr(const char *text, netadr_t *address) {
	if (!Q_stricmp(text, "localhost") || !Q_stricmp(text, "loopback")) {
		Com_Memset(address, 0, sizeof(*address));
		address->type = NA_LOOPBACK;
		return qtrue;
	}
	return qfalse;
}

qboolean Sys_GetPacket(netadr_t *from, msg_t *message) {
	(void)from;
	(void)message;
	return qfalse;
}

void Sys_SendPacket(int length, const void *data, netadr_t to) {
	(void)length;
	(void)data;
	(void)to;
}

qboolean Sys_IsLANAddress(netadr_t address) {
	return address.type == NA_LOOPBACK;
}

void Sys_ShowIP(void) {
	Com_Printf("WebAssembly loopback only\n");
}
