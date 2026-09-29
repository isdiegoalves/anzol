{{/* Nome dos objetos: o da release, com o nome do chart na frente se ela não o tiver. */}}
{{- define "anzol.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Chart.Name .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "anzol.redisName" -}}
{{- printf "%s-redis" (include "anzol.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Recebe (dict "ctx" . "component" "app"|"redis"). */}}
{{- define "anzol.selectorLabels" -}}
app.kubernetes.io/name: {{ .ctx.Chart.Name }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "anzol.labels" -}}
{{ include "anzol.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .ctx.Chart.Name .ctx.Chart.Version }}
{{- end -}}

{{/* Secret da chave de IA: o existente ou o criado pelo chart; vazio quando não há chave. */}}
{{- define "anzol.aiSecretName" -}}
{{- if .Values.anzol.ai.existingSecret -}}
{{- .Values.anzol.ai.existingSecret -}}
{{- else if .Values.anzol.ai.apiKey -}}
{{- printf "%s-ai" (include "anzol.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
ANZOL_ALLOWED_HOSTS: loopback (port-forward), os hosts do Ingress (com :443 os que têm TLS, porque o Origin
https://host chega ao pod por HTTP) e os nomes de anzol.allowedHosts.
*/}}
{{- define "anzol.allowedHosts" -}}
{{- $hosts := list "localhost" "127.0.0.1" "[::1]" -}}
{{- if .Values.ingress.enabled -}}
{{- $hosts = concat $hosts .Values.ingress.hosts -}}
{{- range .Values.ingress.tls -}}
{{- range .hosts -}}
{{- $hosts = append $hosts (printf "%s:443" .) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $hosts = concat $hosts .Values.anzol.allowedHosts -}}
{{- $hosts | uniq | join "," -}}
{{- end -}}
