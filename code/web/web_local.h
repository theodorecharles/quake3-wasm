#ifndef QUAKE3_WEB_LOCAL_H
#define QUAKE3_WEB_LOCAL_H

#include "../game/q_shared.h"
#include "../qcommon/qcommon.h"

#define WEB_MAX_QUEUED_EVENTS 256

void Sys_QueEvent(int time, sysEventType_t type, int value, int value2,
	int ptrLength, void *ptr);
qboolean Sys_GetPacket(netadr_t *from, msg_t *message);
void Sys_SendKeyEvents(void);
void IN_Init(void);
void IN_Shutdown(void);
void IN_Frame(void);
void IN_Activate(void);
void IN_ActivateMouse(void);
void IN_DeactivateMouse(void);

#endif
