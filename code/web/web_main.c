#include "../client/client.h"
#include "web_local.h"

#include <emscripten/emscripten.h>
#include <stdio.h>
#include <string.h>

unsigned sys_frame_time;

static void Web_Frame(void) {
	Com_Frame();
}

int main(int argc, char **argv) {
	char commandLine[MAX_STRING_CHARS];
	int i;

	commandLine[0] = '\0';
	for (i = 1; i < argc; ++i) {
		if (strlen(commandLine) + strlen(argv[i]) + 2 >= sizeof(commandLine)) {
			fprintf(stderr, "[quake3-wasm] command line is too long\n");
			return 1;
		}
		if (commandLine[0]) {
			Q_strcat(commandLine, sizeof(commandLine), " ");
		}
		Q_strcat(commandLine, sizeof(commandLine), argv[i]);
	}

	fprintf(stdout, "[quake3-wasm] starting official id Tech 3 engine\n");
	Sys_SetDefaultInstallPath("/data");
	Sys_SetDefaultHomePath("/persist");
	Sys_SetDefaultCDPath("");
	Com_Init(commandLine);
	NET_Init();
	emscripten_set_main_loop(Web_Frame, 0, 1);
	return 0;
}
